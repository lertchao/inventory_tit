const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const MiniStockTx = require('../models/miniStockTransaction');
const Product = require('../models/products');
const Requester = require('../models/requester');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// ── helpers ──────────────────────────────────────────────────────────────────

async function computeBalanceMap() {
  const txs = await MiniStockTx.find({}).lean();
  const map = {}; // key = "fse|sku"
  for (const tx of txs) {
    const key = `${tx.fse}|${tx.sku}`;
    if (!map[key]) map[key] = { fse: tx.fse, sku: tx.sku, description: tx.description || '', qty: 0 };
    map[key].qty += tx.type === 'TRANSFER' ? tx.quantity : -tx.quantity;
  }
  return map;
}

// ── pages ─────────────────────────────────────────────────────────────────────

router.get('/mini-stock', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const [fses, products, balanceMap, pending] = await Promise.all([
      Requester.find({ isFSE: true, active: true }).sort('shortName').lean(),
      Product.find({ inMiniStock: true, active: { $ne: false } }).sort('sku').lean(),
      computeBalanceMap(),
      MiniStockTx.find({ type: 'USAGE', replenished: false }).sort({ createdAt: -1 }).lean()
    ]);

    // enrich pending with shelf qty
    const pendingSkus = [...new Set(pending.map(p => p.sku))];
    const shelfProducts = await Product.find({ sku: { $in: pendingSkus } }).lean();
    const shelfMap = Object.fromEntries(shelfProducts.map(p => [p.sku, p.quantity]));
    const pendingEnriched = pending.map(p => ({ ...p, shelfQty: shelfMap[p.sku] ?? 0 }));

    const balanceRows = Object.values(balanceMap)
      .filter(r => r.qty !== 0)
      .sort((a, b) => a.fse.localeCompare(b.fse) || a.sku.localeCompare(b.sku));

    res.render('mini-stock', {
      fses,
      products,
      balanceRows,
      pending: pendingEnriched,
      user: req.session.user
    });
  } catch (err) {
    console.error('GET /mini-stock error:', err);
    res.status(500).send('Server Error');
  }
});

// ── API ───────────────────────────────────────────────────────────────────────

// GET /api/mini-stock/fses   (JSON list of active FSE names)
router.get('/api/mini-stock/fses', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const fses = await Requester.find({ isFSE: true, active: true }).sort('shortName').lean();
    res.json(fses.map(f => f.shortName));
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /api/mini-stock/balance   (JSON)
router.get('/api/mini-stock/balance', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const balanceMap = await computeBalanceMap();
    const rows = Object.values(balanceMap).filter(r => r.qty > 0);
    rows.sort((a, b) => a.fse.localeCompare(b.fse) || a.sku.localeCompare(b.sku));
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/mini-stock/transfer   shelf → FSE
router.post('/api/mini-stock/transfer', isAuthenticated, isAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { fse, sku, quantity, note } = req.body;
    const qty = parseInt(quantity, 10);

    if (!fse || !sku || !qty || qty < 1) {
      return res.status(400).json({ ok: false, message: 'กรุณากรอก FSE, SKU และจำนวน' });
    }

    const fseDoc = await Requester.findOne({ shortName: fse, isFSE: true, active: true });
    if (!fseDoc) return res.status(400).json({ ok: false, message: 'ไม่พบ FSE นี้ในระบบ' });

    const product = await Product.findOne({ sku, inMiniStock: true });
    if (!product) return res.status(400).json({ ok: false, message: 'SKU ไม่อยู่ใน Mini Stock list' });

    if (product.quantity < qty) {
      return res.status(400).json({ ok: false, message: `จำนวนบน Shelf ไม่พอ (มี ${product.quantity} ชิ้น)` });
    }

    session.startTransaction();

    product.quantity -= qty;
    await product.save({ session });

    await MiniStockTx.create([{
      type: 'TRANSFER',
      fse,
      sku,
      description: product.description,
      quantity: qty,
      note: note || '',
      createdBy: req.session.user.username
    }], { session });

    await session.commitTransaction();
    res.json({ ok: true, message: `โอน ${qty} ชิ้น (${sku}) ให้ ${fse} สำเร็จ` });
  } catch (err) {
    await session.abortTransaction();
    console.error('POST /api/mini-stock/transfer error:', err);
    res.status(500).json({ ok: false, message: err.message || 'Internal error' });
  } finally {
    session.endSession();
  }
});

// POST /api/mini-stock/usage   FSE used from mini stock
router.post('/api/mini-stock/usage', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { fse, sku, quantity, workOrderId, note } = req.body;
    const qty = parseInt(quantity, 10);

    if (!fse || !sku || !qty || qty < 1) {
      return res.status(400).json({ ok: false, message: 'กรุณากรอก FSE, SKU และจำนวน' });
    }
    if (!workOrderId || !workOrderId.trim()) {
      return res.status(400).json({ ok: false, message: 'กรุณากรอก Work Order ID' });
    }

    const fseDoc = await Requester.findOne({ shortName: fse, isFSE: true, active: true });
    if (!fseDoc) return res.status(400).json({ ok: false, message: 'ไม่พบ FSE นี้ในระบบ' });

    const product = await Product.findOne({ sku, inMiniStock: true });
    if (!product) return res.status(400).json({ ok: false, message: 'SKU ไม่อยู่ใน Mini Stock list' });

    // check balance
    const txs = await MiniStockTx.find({ fse, sku }).lean();
    const balance = txs.reduce((sum, tx) => sum + (tx.type === 'TRANSFER' ? tx.quantity : -tx.quantity), 0);
    if (balance < qty) {
      return res.status(400).json({ ok: false, message: `FSE มีของไม่พอ (balance: ${balance} ชิ้น)` });
    }

    await MiniStockTx.create({
      type: 'USAGE',
      fse,
      sku,
      description: product.description,
      quantity: qty,
      workOrderId: workOrderId.trim(),
      note: note || '',
      createdBy: req.session.user.username,
      replenished: false
    });

    res.json({ ok: true, message: `บันทึกการใช้ ${qty} ชิ้น (${sku}) โดย ${fse} สำเร็จ` });
  } catch (err) {
    console.error('POST /api/mini-stock/usage error:', err);
    res.status(500).json({ ok: false, message: err.message || 'Internal error' });
  }
});

// POST /api/mini-stock/replenish/:id   fulfill a pending USAGE
router.post('/api/mini-stock/replenish/:id', isAuthenticated, isAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const usage = await MiniStockTx.findById(req.params.id);
    if (!usage || usage.type !== 'USAGE') {
      return res.status(404).json({ ok: false, message: 'ไม่พบรายการที่รอเติม' });
    }
    if (usage.replenished) {
      return res.status(400).json({ ok: false, message: 'รายการนี้ถูก replenish ไปแล้ว' });
    }

    const product = await Product.findOne({ sku: usage.sku });
    if (!product) return res.status(404).json({ ok: false, message: 'ไม่พบสินค้า' });

    if (product.quantity < usage.quantity) {
      return res.status(400).json({
        ok: false,
        message: `Shelf ไม่พอ (มี ${product.quantity}, ต้องการ ${usage.quantity})`
      });
    }

    session.startTransaction();

    product.quantity -= usage.quantity;
    await product.save({ session });

    await MiniStockTx.create([{
      type: 'TRANSFER',
      fse: usage.fse,
      sku: usage.sku,
      description: usage.description,
      quantity: usage.quantity,
      note: `Replenish for WO: ${usage.workOrderId}`,
      createdBy: req.session.user.username
    }], { session });

    usage.replenished = true;
    usage.replenishedAt = new Date();
    usage.replenishedBy = req.session.user.username;
    await usage.save({ session });

    await session.commitTransaction();
    res.json({ ok: true, message: 'Replenish สำเร็จ' });
  } catch (err) {
    await session.abortTransaction();
    console.error('POST /api/mini-stock/replenish error:', err);
    res.status(500).json({ ok: false, message: err.message || 'Internal error' });
  } finally {
    session.endSession();
  }
});

// POST /api/requesters/:id/toggle-fse
router.post('/api/requesters/:id/toggle-fse', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const doc = await Requester.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, message: 'ไม่พบ requester นี้' });
    doc.isFSE = !doc.isFSE;
    await doc.save();
    res.json({ ok: true, isFSE: doc.isFSE });
  } catch (err) {
    console.error('toggle-fse error:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
