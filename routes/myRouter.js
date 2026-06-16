const express = require('express')
const router = express.Router()
const Product = require('../models/products')
const Transaction = require('../models/transaction')
const Store = require('../models/store')
const Requester = require('../models/requester')
const Announcement = require('../models/announcement')
const Sequence = require("../models/Sequence")
const fs = require('fs');
const path = require('path');
const { cloudinary, upload } = require('../config/cloudinary');
const mongoose = require("mongoose");


const { isAuthenticated, isAdmin } = require("../middleware/auth")
const bcrypt = require("bcrypt")
const User = require("../models/user")

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);


function parseStoreId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

async function generateManualRequestId(session) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const yyyymm = `${year}${month}`;
  const key = `MANUAL-ISSUE-${yyyymm}`;

  const counter = await Sequence.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  const running = String(counter.seq).padStart(4, "0");
  return `${yyyymm}-${running}`;
}

router.get("/manual-issue-parts", isAuthenticated, isAdmin, (req, res) => {
  res.render("manual_trans-out");
});

router.get("/api/manual-issue-next-id", isAuthenticated, isAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const manualId = await generateManualRequestId(session);

    // rollback เพื่อให้เป็น preview อย่างเดียว ยังไม่ consume running จริง
    await session.abortTransaction();

    return res.json({ requestId: manualId });
  } catch (error) {
    console.error("❌ /api/manual-issue-next-id:", error);
    try { await session.abortTransaction(); } catch (_) {}
    return res.status(500).json({ error: "ไม่สามารถสร้างเลขที่ใบเบิกได้" });
  } finally {
    session.endSession();
  }
});

router.post("/add_manual_trans-out", isAuthenticated, isAdmin, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { name, workStatus, storeId, products } = req.body;
    const nameTrim = (name || "").trim();
    const storeIdNum = Number(storeId);

    if (!nameTrim || !storeIdNum || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ alert: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    const store = await Store.findOne({ storeId: storeIdNum }).session(session);
    if (!store) {
      return res.status(404).json({ alert: "ไม่พบรหัสสาขานี้" });
    }

    const requesterDoc = await Requester.findOne({
      shortName: nameTrim,
      active: true
    }).session(session);

    if (!requesterDoc) {
      return res.status(400).json({
        alert: `ไม่พบชื่อผู้เบิก "${nameTrim}" ในระบบ หรือถูกปิดใช้งาน`
      });
    }

    // กัน SKU ซ้ำ
    const seen = new Set();
    const dups = new Set();

    for (const item of products) {
      const sku = (item?.sku || "").trim().toUpperCase();
      if (!sku) continue;
      if (seen.has(sku)) dups.add(sku);
      else seen.add(sku);
    }

    if (dups.size > 0) {
      return res.status(400).json({
        alert: `พบรหัสสินค้าในคำสั่งนี้ซ้ำกัน: ${[...dups].join(", ")}\nโปรดรวมให้เหลือรหัสละ 1 แถวก่อนบันทึก`
      });
    }

    // ตรวจ stock
    const insufficientStock = [];
    const validatedProducts = [];

    for (const item of products) {
      const sku = (item?.sku || "").trim();
      const quantity = Number(item?.quantity);

      if (!sku || !Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({
          alert: `SKU: ${sku || "ไม่ระบุ"} → จำนวนไม่ถูกต้อง`
        });
      }

      const product = await Product.findOne({
        sku,
        active: { $ne: false }
      }).session(session);

      if (!product) {
        return res.status(404).json({ alert: `ไม่พบสินค้า SKU: ${sku}` });
      }

      if ((product.quantity || 0) < quantity) {
        insufficientStock.push({
          sku,
          available: product.quantity || 0
        });
      }

      validatedProducts.push({
        sku: product.sku,
        description: product.description || "",
        quantity,
        cost: Number(product.cost) || 0
      });
    }

    if (insufficientStock.length > 0) {
      const alertMessage = insufficientStock
        .map(item => `SKU: ${item.sku} คงเหลือ: ${item.available}`)
        .join("<br>");

      return res.status(400).json({
        alert: `สินค้าบางรายการมีจำนวนไม่เพียงพอ<br>${alertMessage}`
      });
    }

    // generate เลขเอกสารจริงตอน save เท่านั้น
    const requestId = await generateManualRequestId(session);

    // ตัด stock
    for (const item of validatedProducts) {
      await Product.updateOne(
        {
          sku: item.sku,
          active: { $ne: false }
        },
        { $inc: { quantity: -item.quantity } },
        { session }
      );
    }

    // save transaction
    const status = workStatus || "Finish";

    await Transaction.create([{
      requesterName: nameTrim,
      requestId,
      transactionType: "OUT",
      workStatus: status,
      finishDate: status === "Finish" ? new Date() : null,
      storeId: storeIdNum,
      products: validatedProducts.map(p => ({
        sku: p.sku,
        quantity: p.quantity
      })),
      username: req.user.username,
      remark: "Manual Issue Parts"
    }], { session });

    await session.commitTransaction();

    return res.status(200).json({
      message: "บันทึกข้อมูลเรียบร้อยแล้ว",
      printData: {
        requesterName: nameTrim,
        requestId,
        workStatus: workStatus || "Finish",
        storeId: store.storeId,
        storeName: store.storename,
        createdBy: req.user.username,
        createdAt: new Date(),
        products: validatedProducts.map((p, i) => ({
          no: i + 1,
          sku: p.sku,
          description: p.description,
          quantity: p.quantity,
          cost: p.cost,
          total: p.quantity * p.cost
        }))
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("❌ /add_manual_trans-out:", error);
    return res.status(500).json({ alert: "ไม่สามารถบันทึกข้อมูลได้" });
  } finally {
    session.endSession();
  }
});

router.get('/manual-slip/:requestId', isAuthenticated, async (req, res) => {
  try {
    const requestId = req.params.requestId;

    const transactions = await Transaction.find({ requestId })
      .sort({ createdAt: 1 })
      .lean();

    if (!transactions || transactions.length === 0) {
      return res.status(404).send('ไม่พบข้อมูลใบเบิก');
    }

    const store = await Store.findOne({ storeId: transactions[0].storeId }).lean();

    // summary net by sku
    const summaryMap = {};

    transactions.forEach((tx) => {
      (tx.products || []).forEach((p) => {
        const sku = p.sku;
        if (!summaryMap[sku]) {
          summaryMap[sku] = {
            sku,
            description: p.description || '',
            quantity: 0,
            cost: 0,
            total: 0
          };
        }

        // ใช้เฉพาะ OUT สุทธิที่ยังเหลือใช้งานจริง
        if ((tx.transactionType || '').toUpperCase() === 'OUT') {
          summaryMap[sku].quantity += Number(p.quantity || 0);
        } else if ((tx.transactionType || '').toUpperCase() === 'IN') {
          summaryMap[sku].quantity -= Number(p.quantity || 0);
        }
      });
    });

    // ดึง cost ล่าสุดจาก Product
    const skuList = Object.keys(summaryMap);
    const products = await Product.find({ sku: { $in: skuList } }).lean();
    const productMap = new Map(products.map(p => [p.sku, p]));

    const items = Object.values(summaryMap)
      .filter(item => item.quantity > 0)
      .map((item, index) => {
        const productDoc = productMap.get(item.sku);
        const cost = Number(productDoc?.cost || 0);
        const total = cost * item.quantity;

        return {
          no: index + 1,
          sku: item.sku,
          description: item.description || productDoc?.description || '',
          quantity: item.quantity,
          cost,
          total
        };
      });

    const grandTotal = items.reduce((sum, item) => sum + item.total, 0);

    res.render('manual-slip', {
      requestId,
      requesterName: transactions[0].requesterName || '',
      storeId: transactions[0].storeId || '',
      storeName: store?.storename || '',
      workStatus: transactions[0].workStatus || '',
      createdAt: transactions[0].createdAt,
      items,
      grandTotal
    });
  } catch (error) {
    console.error('❌ /manual-slip/:requestId', error);
    res.status(500).send('เกิดข้อผิดพลาดในการสร้างใบพิมพ์');
  }
});

router.get('/stores', isAuthenticated, isAdmin, (req, res) => {
  res.render('stores', { user: req.user });
});

router.get('/stores/list', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const stores = await Store.find({}).sort({ storeId: 1 }).lean();
    res.json({ ok: true, data: stores });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/stores', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const storeId = parseStoreId(req.body.storeId);
    const storename = (req.body.storename || '').trim();

    if (storeId === null) return res.status(400).json({ ok: false, message: 'storeId ต้องเป็นจำนวนเต็ม (0 ขึ้นไป)' });
    if (!storename)   return res.status(400).json({ ok: false, message: 'กรุณากรอก storename' });

    const created = await Store.create({ storeId, storename });
    res.json({ ok: true, data: created });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ ok: false, message: 'storeId นี้มีอยู่แล้ว' });
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.put('/stores/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const update = {};
    if (req.body.storeId !== undefined) {
      const storeId = parseStoreId(req.body.storeId);
      if (storeId === null) return res.status(400).json({ ok: false, message: 'storeId ไม่ถูกต้อง' });
      update.storeId = storeId;
    }
    if (req.body.storename !== undefined) {
      const storename = (req.body.storename || '').trim();
      if (!storename) return res.status(400).json({ ok: false, message: 'storename ห้ามว่าง' });
      update.storename = storename;
    }

    const doc = await Store.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ ok: false, message: 'ไม่พบรายการ' });
    res.json({ ok: true, data: doc });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ ok: false, message: 'storeId ซ้ำกับรายการอื่น' });
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/stores/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await Store.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, message: 'ไม่พบรายการ' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});


router.get("/register",isAuthenticated, isAdmin,(req, res) => {
  res.render("register", {
    message: null,
    success: false
  });
});

router.post("/register",isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { username, password, confirmPassword, role } = req.body;

    if (password !== confirmPassword) {
      return res.render("register", {
        message: "❌ รหัสผ่านไม่ตรงกัน",
        success: false,
      });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.render("register", {
        message: "ชื่อผู้ใช้นี้ถูกใช้แล้ว",
        success: false,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      password: hashedPassword,
      role: role || "viewer", // ถ้าไม่เลือก role ให้เป็น viewer
    });

    await newUser.save();

    // ✅ แสดง alert และ redirect ไป login หลัง 3 วินาที
    res.render("register", {
      message: null,
      success: true,
    });
  } catch (error) {
    console.error("สมัครสมาชิกผิดพลาด:", error);
    res.status(500).send("เกิดข้อผิดพลาดในการสมัครสมาชิก: " + error.message);
  }
});

router.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/");
  res.render("login", { message: "" });
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    // ตรวจสอบว่า username/password ถูกต้องไหม
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render("login", {
        message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
      });
    }

    // ✅ เก็บ user info ลง session
    req.session.user = {
      _id: user._id,
      username: user.username,
      role: user.role
    };

    // ✅ เซต success message และบันทึก session
    req.session.successMessage = "เข้าสู่ระบบสำเร็จ";
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // ✅ redirect หลัง session ถูกบันทึกแน่นอน
    res.redirect("/");
    
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).send("เกิดข้อผิดพลาด");
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ loggedOut: true, message: "ออกจากระบบสำเร็จ" });
  });
});

router.get("/", isAuthenticated, async (req, res) => {
  try {
    const searchQuery = req.query.search?.trim() || ""; // รับค่าค้นหาและตัดช่องว่าง
    let matchStage = {}; // ใช้เป็นค่าว่างถ้าไม่มีการค้นหา

    if (searchQuery) {
      matchStage = { requestId: searchQuery }; // ค้นหาตาม Request ID
    }

    // ดึงข้อมูลสำหรับกราฟ (เฉพาะงานที่ยัง Pending)
    const pendingWorkOrders = await Transaction.aggregate([
      { $match: { workStatus: "Pending" } }, // ค้นหาเฉพาะงานที่ยัง Pending
      { $unwind: "$products" }, // แยกออกเป็นหลายรายการสำหรับแต่ละ SKU
      {
        $lookup: {
          from: "products", // ชื่อตารางหรือ collection ที่เก็บข้อมูลสินค้า
          localField: "products.sku", // ฟิลด์ SKU ที่ต้องการค้นหา
          foreignField: "sku", // ฟิลด์ SKU ใน collection ของสินค้า
          as: "productInfo", // ชื่อฟิลด์ที่เก็บข้อมูลสินค้า
        },
      },
      { $unwind: "$productInfo" }, // เอาข้อมูลจาก productInfo มารวมกับแต่ละรายการของ products
      {
        $group: {
          _id: {
            requesterName: "$requesterName",
            typeparts: "$productInfo.typeparts",
            requestId: "$requestId",
          }, // กลุ่มตาม requesterName, typeparts, และ requestId
          totalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$transactionType", "OUT"] }, // ถ้า transactionType เป็น "OUT"
                then: {
                  $multiply: ["$products.quantity", "$productInfo.cost"],
                },
                else: {
                  $multiply: ["$products.quantity", "$productInfo.cost", -1],
                }, // ถ้าเป็น "IN" ให้ลบค่าออกจาก totalCost
              },
            },
          },
        },
      },
      {
        $group: {
          _id: "$_id.requesterName", // กลุ่มตาม requesterName
          cmTotalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "CM"] }, // กรณีเป็น CM
                then: "$totalCost",
                else: 0,
              },
            },
          },
          pmTotalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "PM"] }, // กรณีเป็น PM
                then: "$totalCost",
                else: 0,
              },
            },
          },
          cmPendingCount: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "CM"] }, // นับเฉพาะ Pending ที่เป็น CM
                then: 1,
                else: 0,
              },
            },
          },
          pmPendingCount: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "PM"] }, // นับเฉพาะ Pending ที่เป็น PM
                then: 1,
                else: 0,
              },
            },
          },
        },
      },
      // เพิ่มขั้นตอนนี้เพื่อคำนวณ totalCombinedCost
      {
        $addFields: {
          totalCombinedCost: { $add: ["$cmTotalCost", "$pmTotalCost"] }, // คำนวณ totalCost รวมของ CM + PM
        },
      },
      { $sort: { totalCombinedCost: -1 } }, // เรียงจาก CM + PM ที่มีค่า totalCost รวมมากที่สุด
    ]);

    // ดึงข้อมูล Parts Movement วันนี้
    const today = dayjs().tz('Asia/Bangkok').startOf('day').toDate();


    const partsMovementToday = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: today }, // ค้นหาธุรกรรมที่เกิดขึ้นในวันนี้
        },
      },
      { $unwind: "$products" }, // แยก products ออกมาเป็นแต่ละรายการ
      {
        $lookup: {
          from: "products", // ดึงข้อมูลจาก Collection 'products'
          localField: "products.sku",
          foreignField: "sku",
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" }, // ใช้ข้อมูลสินค้าร่วมด้วย
      {
        $group: {
          _id: {
            partId: "$products.sku",
            partName: "$productInfo.description",
            onHand: "$productInfo.quantity", // สต๊อกคงเหลือปัจจุบัน
          },
          totalIn: {
            $sum: {
              $cond: {
                if: { $eq: ["$transactionType", "IN"] }, // กรณีเป็น "IN"
                then: "$products.quantity",
                else: 0,
              },
            },
          },
          totalOut: {
            $sum: {
              $cond: {
                if: { $eq: ["$transactionType", "OUT"] }, // กรณีเป็น "OUT"
                then: "$products.quantity",
                else: 0,
              },
            },
          },
        },
      },
      { $sort: { "_id.partId": 1 } }, // เรียงตามรหัสสินค้า
    ]);

    let pendingWorkOrdersTable = await Transaction.aggregate([
      { $match: { workStatus: "Pending" } },
      { $unwind: "$products" },
      {
        $lookup: {
          from: "products",
          localField: "products.sku",
          foreignField: "sku",
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" },
      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "storeId",
          as: "storeInfo",
        },
      },
      { $unwind: { path: "$storeInfo", preserveNullAndEmptyArrays: true } },
    
      // 🔹 Group by requestId + typeparts
      {
        $group: {
          _id: {
            requestId: "$requestId",
            requesterName: "$requesterName",
            storeId: "$storeId",
            storename: "$storeInfo.storename",
            typeparts: "$productInfo.typeparts",
          },
          totalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$transactionType", "OUT"] },
                then: {
                  $multiply: ["$products.quantity", "$productInfo.cost"],
                },
                else: {
                  $multiply: ["$products.quantity", "$productInfo.cost", -1],
                },
              },
            },
          },
          earliestTransactionDate: { $min: "$createdAt" }, // ✅ เปลี่ยนจาก $max เป็น $min
        },
      },
    
      // 🔸 รวม typeparts กลับเป็นใบงานเดียว
      {
        $group: {
          _id: {
            requestId: "$_id.requestId",
            requesterName: "$_id.requesterName",
            storeId: "$_id.storeId",
            storename: "$_id.storename",
          },
          cmTotalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "CM"] },
                then: "$totalCost",
                else: 0,
              },
            },
          },
          pmTotalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "PM"] },
                then: "$totalCost",
                else: 0,
              },
            },
          },
          earliestTransactionDate: { $min: "$earliestTransactionDate" }, // ✅ เปลี่ยนจาก $max เป็น $min
        },
      },
    
      {
        $addFields: {
          totalCombinedCost: { $add: ["$cmTotalCost", "$pmTotalCost"] },
        },
      },
      {
        $sort: {
          "_id.requesterName": 1,
          "_id.requestId": 1,
        },
      },
    ]);
    
    const current = new Date();
    
    pendingWorkOrdersTable = pendingWorkOrdersTable.map((item) => {
      const earliest = item.earliestTransactionDate
        ? new Date(item.earliestTransactionDate)
        : null;
      const pendingDays = earliest
        ? Math.floor((current - earliest) / (1000 * 60 * 60 * 24))
        : null;
    
      return {
        ...item,
        earliestTransactionDate: earliest,
        pendingDays,
      };
    });
    

    const totalSKUs = await Product.countDocuments();
    const totalStockQty = await Product.aggregate([
      { $group: { _id: null, totalQty: { $sum: "$quantity" } } },
    ]);

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const top20Movement = await Transaction.aggregate([
      {
        $match: {
          workStatus: "Finish",
          finishDate: {
            $gte: firstDayOfMonth,
            $lte: lastDayOfMonth,
            $ne: null
          }
        }
      },
        
      // 2) แตกสินค้าแต่ละบรรทัด
      { $unwind: "$products" },
    
      // 3) ปรับ transactionType ให้เป็นตัวพิมพ์ใหญ่กันพลาด
      { $addFields: { normType: { $toUpper: "$transactionType" } } },
    
      // 4) สรุป "ยอดสุทธิรายใบงาน–ราย SKU"
      {
        $group: {
          _id: {
            requestId: "$requestId",
            sku: "$products.sku",
          },
          netQtyPerWO: {
            $sum: {
              $cond: [
                { $eq: ["$normType", "OUT"] },
                "$products.quantity",
                { $multiply: ["$products.quantity", -1] }
              ]
            }
          }
        }
      },
    
      // 5) ตัดทิ้งกรณีสุทธิ ≤ 0 (ไม่ได้ “ใช้จริง”)
      { $match: { netQtyPerWO: { $gt: 0 } } },
    
      // 6) รวมสุทธิรายเดือน "ต่อ SKU" จากหลายใบงานที่จบแล้ว
      {
        $group: {
          _id: "$_id.sku",
          totalIssuedNet: { $sum: "$netQtyPerWO" },
        }
      },
    
      // 7) ดึงรายละเอียดสินค้า
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "sku",
          as: "productInfo"
        }
      },
      { $unwind: "$productInfo" },
    
      // 8) เตรียมข้อมูลส่งออก
      {
        $project: {
          sku: "$_id",
          description: "$productInfo.description",
          totalIssued: "$totalIssuedNet" // ← “สุทธิรายเดือน”
        }
      },
    
      // 9) เรียงและจำกัด 15 อันดับ
      { $sort: { totalIssued: -1 } },
      { $limit: 20 }
    ]);
    
    
    

    const totalStockValue = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalValue: { $sum: { $multiply: ["$cost", "$quantity"] } },
        },
      },
    ]);

    const pendingSummary = await Transaction.aggregate([
      { $match: { workStatus: "Pending" } },
      { $unwind: "$products" },
      {
        $lookup: {
          from: "products",
          localField: "products.sku",
          foreignField: "sku",
          as: "productInfo"
        }
      },
      { $unwind: "$productInfo" },
      {
        $group: {
          _id: null,
          totalPendingQty: {
            $sum: {
              $cond: [
                { $eq: ["$transactionType", "OUT"] },
                "$products.quantity",
                { $multiply: ["$products.quantity", -1] } // ลบคืน IN
              ]
            }
          },
          totalPendingValue: {
            $sum: {
              $cond: [
                { $eq: ["$transactionType", "OUT"] },
                { $multiply: ["$products.quantity", "$productInfo.cost"] },
                { $multiply: ["$products.quantity", "$productInfo.cost", -1] }
              ]
            }
          }
        }
      }
    ]);
    
    const totalPendingQty = pendingSummary[0]?.totalPendingQty || 0;
    const totalPendingValue = pendingSummary[0]?.totalPendingValue || 0;

    res.render("index", {
      totalPendingQty,
      totalPendingValue,
      pendingWorkOrders,
      searchQuery,
      partsMovementToday,
      pendingWorkOrdersTable,
      totalSKUs,
      totalStockQty: totalStockQty[0]?.totalQty || 0,
      top20Movement,
      totalStockValue: totalStockValue[0]?.totalValue || 0,
    });
  } catch (error) {
    console.error("Error fetching work orders:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.get('/import-form',isAuthenticated, isAdmin,(req,res)=>{
  res.render('import-form')
})

router.get('/trans-in',isAuthenticated, isAdmin,(req,res)=>{
    res.render('trans-in')
})

router.get('/trans-out',isAuthenticated, isAdmin,(req,res)=>{
    res.render('trans-out')
})


router.get('/onhand',isAuthenticated, async (req, res) => {
  const perPage = 12;
  const page = parseInt(req.query.page) || 1;
  const searchQueryRaw = (req.query.search || '').trim();

  // รับค่า filter: 'all' | 'available' | 'out' (ค่าเริ่มต้น = 'all')
  const filter = (req.query.filter || 'all').toString();

  // machineTypes (array)
  let machineTypes = req.query.machineTypes || [];
  if (!Array.isArray(machineTypes)) machineTypes = [machineTypes];
  machineTypes = machineTypes
    .flatMap(v => (typeof v === 'string' ? v.split(',') : v))
    .map(v => v.trim())
    .filter(Boolean);

  // เงื่อนไขค้นหา
  const condition = {
  active: { $ne: false }
  };
  
  if (searchQueryRaw) {
    const escaped = searchQueryRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    condition.$or = [
      { sku: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } }
    ];
  }
  if (machineTypes.length > 0) {
    condition.machineTypes = { $in: machineTypes };
  }

  // ✅ เงื่อนไข filter ตามสวิตช์
  if (filter === 'available') {
    condition.quantity = { $gt: 0 };       // เฉพาะมีของ
  } else if (filter === 'out') {
    condition.quantity = { $lte: 0 };      // เฉพาะของหมด
  } // 'all' = ไม่ใส่เงื่อนไข quantity

  const total = await Product.countDocuments(condition);
  const products = await Product.find(condition)
    .sort({ sku: 1 })
    .skip((page - 1) * perPage)
    .limit(perPage);

  // รายการ Machine Types ทั้งหมด
  let machineTypeOptions = await Product.distinct("machineTypes");
  machineTypeOptions = (machineTypeOptions || [])
    .filter(Boolean)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  res.render('onhand', {
    products,
    search: searchQueryRaw,
    current: page,
    pages: Math.ceil(total / perPage),
    machineTypesSelected: machineTypes,
    machineTypeOptions,
    filter   // 👉 ส่งค่านี้ให้ EJS ตั้งค่าสวิตช์ + สร้างลิงก์เพจ
  });
});


router.get('/public-onhand', async (req, res) => {
  const perPage = 12;
  const page = parseInt(req.query.page) || 1;
  const searchQueryRaw = (req.query.search || '').trim();

  // รับค่า filter: 'all' | 'available' | 'out' (ค่าเริ่มต้น = 'all')
  const filter = (req.query.filter || 'all').toString();

  // machineTypes (array)
  let machineTypes = req.query.machineTypes || [];
  if (!Array.isArray(machineTypes)) machineTypes = [machineTypes];
  machineTypes = machineTypes
    .flatMap(v => (typeof v === 'string' ? v.split(',') : v))
    .map(v => v.trim())
    .filter(Boolean);

  // เงื่อนไขค้นหา
  const condition = {
  active: { $ne: false }
  };
  if (searchQueryRaw) {
    const escaped = searchQueryRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    condition.$or = [
      { sku: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } }
    ];
  }
  if (machineTypes.length > 0) {
    condition.machineTypes = { $in: machineTypes };
  }

  // ✅ เงื่อนไข filter ตามสวิตช์
  if (filter === 'available') {
    condition.quantity = { $gt: 0 };       // เฉพาะมีของ
  } else if (filter === 'out') {
    condition.quantity = { $lte: 0 };      // เฉพาะของหมด
  } // 'all' = ไม่ใส่เงื่อนไข quantity

  const total = await Product.countDocuments(condition);
  const products = await Product.find(condition)
    .sort({ sku: 1 })
    .skip((page - 1) * perPage)
    .limit(perPage);

  // รายการ Machine Types ทั้งหมด
  let machineTypeOptions = await Product.distinct("machineTypes");
  machineTypeOptions = (machineTypeOptions || [])
    .filter(Boolean)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  res.render('onhand-public', {
    products,
    search: searchQueryRaw,
    current: page,
    pages: Math.ceil(total / perPage),
    machineTypesSelected: machineTypes,
    machineTypeOptions,
    filter   // 👉 ส่งค่านี้ให้ EJS ตั้งค่าสวิตช์ + สร้างลิงก์เพจ
  });
});

router.get("/public-pending", async (req, res) => {
  try {
    const searchQuery = req.query.search?.trim() || ""; // รับค่าค้นหาและตัดช่องว่าง
    let matchStage = {}; // ใช้เป็นค่าว่างถ้าไม่มีการค้นหา

    if (searchQuery) {
      matchStage = { requestId: searchQuery }; // ค้นหาตาม Request ID
    }

// ดึงข้อมูลสำหรับกราฟ (เฉพาะงานที่ยัง Pending)
const pendingWorkOrders = await Transaction.aggregate([
  { $match: { workStatus: "Pending" } },                 // เฉพาะ Pending
  { $unwind: "$products" },
  {
    $lookup: {
      from: "products",
      localField: "products.sku",
      foreignField: "sku",
      as: "productInfo",
    },
  },
  { $unwind: "$productInfo" },

  // กลุ่มตาม requesterName + typeparts + requestId เพื่อคำนวณ totalCost ต่อใบงาน
  {
    $group: {
      _id: {
        requesterName: "$requesterName",
        typeparts: "$productInfo.typeparts",
        requestId: "$requestId",
      },
      totalCost: {
        $sum: {
          $cond: [
            { $eq: ["$transactionType", "OUT"] },
            { $multiply: ["$products.quantity", "$productInfo.cost"] },
            { $multiply: ["$products.quantity", "$productInfo.cost", -1] }
          ]
        }
      }
    }
  },

  // กลับมารวมตาม requesterName อีกครั้ง:
  // - รวม cost แยก CM/PM
  // - เก็บ requestId ไม่ซ้ำ เพื่อนับจำนวนใบงานจริง
  {
    $group: {
      _id: "$_id.requesterName",
      cmTotalCost: {
        $sum: {
          $cond: [{ $eq: ["$_id.typeparts", "CM"] }, "$totalCost", 0]
        }
      },
      pmTotalCost: {
        $sum: {
          $cond: [{ $eq: ["$_id.typeparts", "PM"] }, "$totalCost", 0]
        }
      },
      requestIds: { $addToSet: "$_id.requestId" }  // ✅ เก็บชุด requestId ไม่ซ้ำ
    }
  },

  // คำนวณรวม/นับจำนวนใบงาน
  {
    $addFields: {
      totalCombinedCost: { $add: ["$cmTotalCost", "$pmTotalCost"] },
      pendingJobs: { $size: "$requestIds" }          // ✅ จำนวนใบงานตาม requestId (unique)
    }
  },

  { $sort: { totalCombinedCost: -1 } }
]);


    let pendingWorkOrdersTable = await Transaction.aggregate([
      { $match: { workStatus: "Pending" } },
      { $unwind: "$products" },
      {
        $lookup: {
          from: "products",
          localField: "products.sku",
          foreignField: "sku",
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" },
      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "storeId",
          as: "storeInfo",
        },
      },
      { $unwind: { path: "$storeInfo", preserveNullAndEmptyArrays: true } },

      // 🔹 Group by requestId + typeparts
      {
        $group: {
          _id: {
            requestId: "$requestId",
            requesterName: "$requesterName",
            storeId: "$storeId",
            storename: "$storeInfo.storename",
            typeparts: "$productInfo.typeparts",
          },
          totalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$transactionType", "OUT"] },
                then: {
                  $multiply: ["$products.quantity", "$productInfo.cost"],
                },
                else: {
                  $multiply: ["$products.quantity", "$productInfo.cost", -1],
                },
              },
            },
          },
          earliestTransactionDate: { $min: "$createdAt" }, // ✅ เปลี่ยนจาก $max เป็น $min
        },
      },

      // 🔸 รวม typeparts กลับเป็นใบงานเดียว
      {
        $group: {
          _id: {
            requestId: "$_id.requestId",
            requesterName: "$_id.requesterName",
            storeId: "$_id.storeId",
            storename: "$_id.storename",
          },
          cmTotalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "CM"] },
                then: "$totalCost",
                else: 0,
              },
            },
          },
          pmTotalCost: {
            $sum: {
              $cond: {
                if: { $eq: ["$_id.typeparts", "PM"] },
                then: "$totalCost",
                else: 0,
              },
            },
          },
          earliestTransactionDate: { $min: "$earliestTransactionDate" }, // ✅ เปลี่ยนจาก $max เป็น $min
        },
      },

      {
        $addFields: {
          totalCombinedCost: { $add: ["$cmTotalCost", "$pmTotalCost"] },
        },
      },
      {
        $sort: {
          "_id.requesterName": 1,
          "_id.requestId": 1,
        },
      },
    ]);

    const current = new Date();

    pendingWorkOrdersTable = pendingWorkOrdersTable.map((item) => {
      const earliest = item.earliestTransactionDate
        ? new Date(item.earliestTransactionDate)
        : null;
      const pendingDays = earliest
        ? Math.floor((current - earliest) / (1000 * 60 * 60 * 24))
        : null;

      return {
        ...item,
        earliestTransactionDate: earliest,
        pendingDays,
      };
    });

    res.render("pending-public", {
      pendingWorkOrders,
      searchQuery,

      pendingWorkOrdersTable,
    });
  } catch (error) {
    console.error("Error fetching work orders:", error);
    res.status(500).send("Internal Server Error");
  }
});


router.post('/delete/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/edit-product');
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).send("เกิดข้อผิดพลาด");
  }
});


router.get("/transaction", isAuthenticated, async (req, res) => {
  try {
    const searchQuery = (req.query.search || "").trim();
    const TZ = "Asia/Bangkok";

    // รับช่วงวันที่จาก query — default = วันนี้
    const startRaw = req.query.startDate || dayjs().tz(TZ).format("YYYY-MM-DD");
    const endRaw   = req.query.endDate   || dayjs().tz(TZ).format("YYYY-MM-DD");

    const rangeStart = dayjs.tz(startRaw, TZ).startOf("day").toDate();
    const rangeEnd   = dayjs.tz(endRaw,   TZ).endOf("day").toDate();

    // 1) โหลดเฉพาะ transaction ในช่วงวันที่เลือก
    const transactions = await Transaction.find({
      createdAt: { $gte: rangeStart, $lte: rangeEnd }
    })
      .sort({ createdAt: 1 })
      .lean();

    // 2) รวบ SKU ที่ปรากฏในช่วงนี้
    const skusInRange = [...new Set(
      transactions.flatMap(tx => tx.products.map(p => p.sku))
    )];

    // 3) คำนวณ starting balance ของแต่ละ SKU ก่อนช่วงวันที่เลือก
    const startingData = skusInRange.length > 0
      ? await Transaction.aggregate([
          { $match: { createdAt: { $lt: rangeStart } } },
          { $unwind: "$products" },
          { $match: { "products.sku": { $in: skusInRange } } },
          {
            $group: {
              _id: "$products.sku",
              balance: {
                $sum: {
                  $cond: [
                    { $eq: ["$transactionType", "IN"] },
                    "$products.quantity",
                    { $multiply: ["$products.quantity", -1] }
                  ]
                }
              }
            }
          }
        ])
      : [];

    // 4) ดึง description จาก Product
    const productsMap = skusInRange.length > 0
      ? await Product.find({ sku: { $in: skusInRange } })
          .lean()
          .then(list => list.reduce((m, p) => { m[p.sku] = p; return m; }, {}))
      : {};

    // ดึง store name สำหรับ storeId ที่ปรากฏในช่วงนี้
    const storeIds = [...new Set(transactions.map(tx => tx.storeId).filter(id => id != null))];
    const storeMap = storeIds.length > 0
      ? await Store.find({ storeId: { $in: storeIds } })
          .lean()
          .then(list => list.reduce((m, s) => { m[s.storeId] = s.storename; return m; }, {}))
      : {};

    // 5) เริ่ม skuBalances จาก starting balance
    const skuBalances = {};
    startingData.forEach(({ _id, balance }) => { skuBalances[_id] = balance; });
    skusInRange.forEach(sku => { if (skuBalances[sku] === undefined) skuBalances[sku] = 0; });

    // 6) คำนวณ running balance ไล่ตามลำดับเวลา
    let enrichedTransactions = transactions.map((transaction) => {
      const updatedProducts = transaction.products.map((product) => {
        const sku = product.sku;
        if (transaction.transactionType === "IN") {
          skuBalances[sku] = (skuBalances[sku] || 0) + product.quantity;
        } else if (transaction.transactionType === "OUT") {
          skuBalances[sku] = (skuBalances[sku] || 0) - product.quantity;
        }
        return {
          ...product,
          description: productsMap[sku]?.description || "N/A",
          remaining: skuBalances[sku],
        };
      });

      return {
        ...transaction,
        products: updatedProducts,
        storeName: storeMap[transaction.storeId] || "-",
        createdAtFormatted: dayjs(transaction.createdAt)
          .tz(TZ)
          .format("DD MMM YYYY, HH:mm"),
        createdAtExcel: dayjs(transaction.createdAt)
          .tz(TZ)
          .format("YYYY-MM-DD HH:mm:ss"),
      };
    });

    // 7) กรอง SKU ตาม searchQuery (ถ้ามี)
    if (searchQuery) {
      enrichedTransactions = enrichedTransactions
        .map(tx => ({
          ...tx,
          products: tx.products.filter(p =>
            p.sku.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter(tx => tx.products.length > 0);
    }

    res.render("transaction", {
      products: enrichedTransactions,
      searchQuery,
      startDate: startRaw,
      endDate: endRaw,
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).send("Error fetching transactions");
  }
});



router.get('/workorder', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const dayjs = require('dayjs');
    const tz = require('dayjs/plugin/timezone');
    const utc = require('dayjs/plugin/utc');
    dayjs.extend(utc);
    dayjs.extend(tz);

    const searchQuery  = (req.query.search || '').trim();
    const statusFilter = (req.query.statusFilter || '').trim();
    const storeIdRaw   = (req.query.storeId || '').trim();

    // รับค่าหน้า (1,2,3..) จาก query ถ้าไม่ส่งมาก็หน้า 1
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = 100; // ดึงทีละ 100 แถวพอ
    const skip  = (page - 1) * limit;

    const matchStage = {};
    const orConds = [];

    if (searchQuery) {
      const safe = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      orConds.push({ requestId: { $regex: rx } }, { requesterName: { $regex: rx } });
    }
    if (orConds.length > 0) {
      matchStage.$or = orConds;
    }

    if (storeIdRaw) {
      const digits = storeIdRaw.replace(/\D/g, '').slice(0, 3);
      if (digits) {
        const storeIdNum = parseInt(digits, 10);
        if (!Number.isNaN(storeIdNum)) {
          matchStage.storeId = storeIdNum;
        }
      }
    }

    if (statusFilter) {
      matchStage.workStatus = statusFilter;
    }

    // pipeline หลัก
    const rows = await Transaction.aggregate([
      { $match: matchStage },

      // ให้เอกสารของแต่ละ requestId เรียงจากใหม่ไปเก่า
      { $sort: { requestId: 1, createdAt: -1 } },

      // หยิบเอกสารล่าสุดของแต่ละ requestId + นับจำนวน
      {
        $group: {
          _id: '$requestId',
          latest: { $first: '$$ROOT' },
          transactionCount: { $sum: 1 }
        }
      },

      // ดึงชื่อร้านจาก storeId ของแถวล่าสุด
      {
        $lookup: {
          from: 'stores',
          localField: 'latest.storeId',
          foreignField: 'storeId',
          as: 'storeInfo'
        }
      },
      { $unwind: { path: '$storeInfo', preserveNullAndEmptyArrays: true } },

      // เรียงตามวันที่ล่าสุด
      { $sort: { 'latest.createdAt': -1 } },

      // ตัดหน้า
      { $skip: skip },
      { $limit: limit },
    ]);

    // เอาไว้หาจำนวนทั้งหมด เพื่อทำ pagination (อาจแยก query อีกทีจะเร็วกว่า)
    const totalGroups = await Transaction.aggregate([
      { $match: matchStage },
      { $group: { _id: '$requestId' } },
      { $count: 'total' }
    ]);
    const total = totalGroups[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    const transactions = rows.map(r => {
      const last = r.latest?.createdAt ? new Date(r.latest.createdAt) : null;
      return {
        _id: r._id,
        requesterName: r.latest?.requesterName || '-',
        createdAtFormatted: last
          ? dayjs(last).tz('Asia/Bangkok').format('DD MMM YYYY, HH:mm')
          : '-',
        lastTxnISO: last ? last.toISOString() : '',
        workStatus: r.latest?.workStatus || '-',
        transactionCount: r.transactionCount ?? 0,
        storeId: r.latest?.storeId ?? null,
        storeName: r.storeInfo?.storename || '-'
      };
    });

    res.render('workorder', {
      transactions,
      searchQuery,
      statusFilter,
      storeId: storeIdRaw,
      page,
      totalPages
    });

  } catch (err) {
    console.error('Error fetching work orders:', err);
    res.status(500).send('Internal Server Error');
  }
});






router.get('/workorder/:requestId', isAuthenticated, async (req, res) => {
  const requestId = decodeURIComponent(req.params.requestId || '');
  try {
    const transactions = await Transaction.aggregate([
      { $match: { requestId } },
      { $unwind: '$products' },

      // ดึงรายละเอียดสินค้าเพื่อแสดง description
      {
        $lookup: {
          from: 'products',
          localField: 'products.sku',
          foreignField: 'sku',
          as: 'productInfo'
        }
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },

      // ดึงชื่อสาขา
      {
        $lookup: {
          from: 'stores',
          localField: 'storeId',
          foreignField: 'storeId',
          as: 'storeInfo'
        }
      },
      { $unwind: { path: '$storeInfo', preserveNullAndEmptyArrays: true } },

      // รวมกลับเป็น 1 เอกสารต่อ Transaction เดิม
      {
        $group: {
          _id: '$_id',
          requesterName:   { $first: '$requesterName' },
          requestId:       { $first: '$requestId' },
          createdAt:       { $first: '$createdAt' },
          updatedAt:       { $first: '$updatedAt' },
          transactionType: { $first: '$transactionType' },
          workStatus:      { $first: '$workStatus' },
          storeId:         { $first: '$storeId' },
          storename:       { $first: '$storeInfo.storename' },
          products: {
            $push: {
              sku: '$products.sku',
              quantity: '$products.quantity',
              description: '$productInfo.description'
            }
          }
        }
      },

      // ✅ คีย์ “วินาทีเดียวกัน” สำหรับจับกลุ่มในฝั่ง EJS
      {
        $addFields: {
          createdAtSecond: {
            $dateToString: {
              date: '$createdAt',
              format: '%Y-%m-%d %H:%M:%S',
              timezone: 'Asia/Bangkok'
            }
          }
        }
      },

      // ✅ เรียงเวลา + `_id` เป็นตัวคั่นกรณีวินาทีเท่ากัน
      { $sort: { createdAt: 1, _id: 1 } }
    ]);

    if (!transactions || transactions.length === 0) {
      return res.status(404).send('No transactions found for this Request ID');
    }

    // ฟอร์แมตเวลาแสดงผล
    transactions.forEach(tx => {
      tx.createdAtFormatted = tx.createdAt
        ? dayjs(tx.createdAt).tz('Asia/Bangkok').format('DD MMM YYYY, HH:mm')
        : '-';
      tx.updatedAtFormatted = tx.updatedAt
        ? dayjs(tx.updatedAt).tz('Asia/Bangkok').format('DD MMM YYYY, HH:mm')
        : '-';
    });

    // ส่งให้ EJS ใช้งาน (หน้า work-detail)
    res.render('work-detail', { transactions, requestId });
  } catch (error) {
    console.error('Error fetching transactions for Request ID:', error);
    res.status(500).send('Internal Server Error');
  }
});





router.put('/workorder/:requestId/update-status', isAuthenticated, async (req, res) => {
  const requestId = decodeURIComponent(req.params.requestId);
  const {
    workStatus,
    newRequestId,
    requesterName,
    storeId,
    forceUpdate,
    isCancel,
    isReturn,
    returnItems,
    addOutItems = [] // รายการ OUT เพิ่ม
  } = req.body;

  try {
    // โหลดธุรกรรมทั้งหมดของใบงานนี้
    const txs = await Transaction.find({ requestId }).lean();
    if (!txs || txs.length === 0) {
      return res.status(404).json({ message: 'No transactions found to update.' });
    }

    const currentStoreId = txs[0].storeId ?? null;

    // เคย Cancel แล้ว → ห้ามแก้ไขทุกกรณี
    if (txs.some(tx => tx.workStatus === 'Cancel')) {
      return res.status(400).json({
        message: 'This work order has already been canceled and cannot be modified.',
      });
    }

    // 🚧 กัน conflict flags
    if (isCancel && isReturn) {
      return res.status(400).json({ message: 'Cannot perform cancel and partial return in the same request.' });
    }
    if (isCancel && Array.isArray(addOutItems) && addOutItems.length > 0) {
      return res.status(400).json({ message: 'Cannot add OUT items when canceling the work order.' });
    }

    // ⛳️==================== EARLY DUPLICATE CHECK ====================
    // เช็ก newRequestId ซ้ำ "ก่อน" ทำ OUT/IN/Update ใดๆ ทั้งสิ้น
    if (newRequestId && newRequestId !== requestId && !forceUpdate) {
      const exists = await Transaction.findOne({ requestId: newRequestId }).lean();
      if (exists) {
        return res.status(200).json({
          message: 'This Request ID already exists. Do you still want to use it?',
          duplicate: true,
        });
      }
    }
    // ================================================================

    // ======================= CANCEL FLOW =======================
    if (workStatus === 'Cancel' || isCancel === true) {
      // ห้ามเปลี่ยน requestId / storeId ตอน Cancel
      if (newRequestId && newRequestId !== requestId) {
        return res.status(400).json({ message: 'เมื่อยกเลิก (Cancel) ห้ามเปลี่ยน Request ID' });
      }
      if (storeId) {
        const cleanStoreId = parseInt(storeId, 10);
        if (Number.isFinite(cleanStoreId) && cleanStoreId !== currentStoreId) {
          return res.status(400).json({ message: 'เมื่อยกเลิก (Cancel) ห้ามเปลี่ยน Store ID' });
        }
      }

      // คำนวณ net ต่อ SKU จาก txs
      const netMap = new Map();
      for (const tx of txs) {
        const sign = (tx.transactionType || '').toLowerCase() === 'in' ? 1 : -1;
        for (const p of tx.products || []) {
          const sku = p.sku;
          const qty = Number(p.quantity) || 0;
          netMap.set(sku, (netMap.get(sku) || 0) + sign * qty);
        }
      }
      const itemsToReturn = [];
      for (const [sku, net] of netMap.entries()) {
        if (net < 0) itemsToReturn.push({ sku, quantity: Math.abs(net) });
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          if (itemsToReturn.length > 0) {
            // ตรวจว่ามีสินค้าใน Product
            const missing = [];
            for (const it of itemsToReturn) {
              const prod = await Product.findOne({ sku: it.sku }).session(session).select('_id');
              if (!prod) missing.push(it.sku);
            }
            if (missing.length > 0) {
              throw { status: 400, message: `ไม่พบสินค้าในระบบ: ${missing.join(', ')}` };
            }

            // ตีกลับสินค้าเข้าคลัง
            for (const it of itemsToReturn) {
              await Product.updateOne(
                { sku: it.sku },
                { $inc: { quantity: it.quantity } },
                { session }
              );
            }

            // รับเข้า IN (สถานะ Cancel)
            const first = txs[0];
            await Transaction.create([{
              requesterName: first.requesterName,
              requestId,
              storeId: currentStoreId,
              transactionType: 'IN',
              workStatus: 'Cancel',
              username: (req.user && req.user.username) ? req.user.username : 'system',
              products: itemsToReturn.map(i => ({ sku: i.sku, quantity: i.quantity })),
            }], { session });
          }

          // เซ็ตธุรกรรมเดิมทั้งหมดเป็น Cancel
          await Transaction.updateMany(
            { requestId },
            { 
              $set: { 
                workStatus: 'Cancel', 
                finishDate: null,
                updatedAt: new Date() 
              } 
            },
            { session }
          );
        });

        const returnedCount = itemsToReturn.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        const totalSkus = itemsToReturn.length;
        const piecesLabel = returnedCount === 1 ? 'piece' : 'pieces';
        const itemsLabel  = totalSkus === 1 ? 'item' : 'items';

        const message = totalSkus > 0
          ? `Canceled successfully. Returned ${returnedCount} ${piecesLabel} (${totalSkus} ${itemsLabel}).`
          : 'Canceled successfully. Nothing to return.';

        return res.json({
          message,
          finalStatus: 'Cancel',
          returned: itemsToReturn,
        });
        } catch (e) {
          if (e && e.status) {
            return res.status(e.status).json({ message: e.message });
          }

          console.error('Additional OUT failed:', e);

          return res.status(500).json({
            message: e?.message || 'Internal Server Error'
          });
        } finally {
          session.endSession();
        }
    }
    // ===================== END CANCEL FLOW =====================

    // ================== PARTIAL RETURN FLOW ==================
    let partialReturnResult = null; // เก็บผลตอบกลับบางส่วน
    if (isReturn === true) {
      // ตรวจ input
      if (!Array.isArray(returnItems) || returnItems.length === 0) {
        return res.status(400).json({ message: 'Return items cannot be empty.' });
      }

      // คำนวณ net ต่อ SKU จากข้อมูลจริงใน DB (กันแก้ payload)
      const netMap = new Map();
      for (const tx of txs) {
        const sign = (tx.transactionType || '').toLowerCase() === 'in' ? 1 : -1;
        for (const p of tx.products || []) {
          const sku = p.sku;
          const qty = Number(p.quantity) || 0;
          netMap.set(sku, (netMap.get(sku) || 0) + sign * qty);
        }
      }

      // เตรียมตรวจสอบ & สร้างรายการคืนจริง
      const toReturn = [];
      for (const item of returnItems) {
        const sku = String(item.sku || '').trim();
        const qty = Number(item.quantity) || 0;
        if (!sku || qty <= 0) {
          return res.status(400).json({ message: 'Invalid return item format.' });
        }
        const net = Number(netMap.get(sku) || 0);
        const maxReturn = net < 0 ? Math.abs(net) : 0;
        if (maxReturn <= 0) {
          return res.status(400).json({ message: `SKU ${sku} has no outstanding to return.` });
        }
        if (qty > maxReturn) {
          return res.status(400).json({ message: `Return quantity exceeds outstanding for SKU: ${sku} (max ${maxReturn}).` });
        }
        toReturn.push({ sku, quantity: qty });
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // ตรวจว่ามีสินค้าอยู่จริง
          const missing = [];
          for (const it of toReturn) {
            const prod = await Product.findOne({ sku: it.sku }).session(session).select('_id');
            if (!prod) missing.push(it.sku);
          }
          if (missing.length > 0) {
            throw { status: 400, message: `ไม่พบสินค้าในระบบ: ${missing.join(', ')}` };
          }

          // อัปเดตคลัง +qty
          for (const it of toReturn) {
            await Product.updateOne(
              { sku: it.sku },
              { $inc: { quantity: it.quantity } },
              { session }
            );
          }

          // บันทึก Transaction IN สำหรับการคืนบางส่วน
          const first = txs[0];
          const statusForReturn = workStatus || first.workStatus || 'Finish';
          const finishDateForReturn =
            statusForReturn === 'Finish'
              ? (first.finishDate || new Date())
              : null;

          await Transaction.create([{
            requesterName: first.requesterName,
            requestId,
            storeId: currentStoreId,
            transactionType: 'IN',
            workStatus: statusForReturn,
            finishDate: finishDateForReturn,
            username: (req.user && req.user.username) ? req.user.username : 'system',
            products: toReturn.map(i => ({ sku: i.sku, quantity: i.quantity })),
          }], { session });
        });

        const returnedCount = toReturn.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        const totalSkus = toReturn.length;
        partialReturnResult = {
          returnedCount,
          totalSkus,
          toReturn
        };
        } catch (e) {
          if (e && e.status) {
            return res.status(e.status).json({ message: e.message });
          }

          console.error('Partial return failed:', e);

          return res.status(500).json({
            message: e?.message || 'Internal Server Error'
          });
        } finally {
          session.endSession();
        }
    }
    // ================= END PARTIAL RETURN FLOW =================

    // ============== ADDITIONAL OUT FLOW =================
    let additionalOutResult = null;
    const hasOut = Array.isArray(addOutItems) && addOutItems.length > 0;
    // ตอนนี้ปลอดภัยแล้ว (duplicate เคลียร์ก่อนหน้า)
    const targetRequestId = (newRequestId && newRequestId !== requestId) ? newRequestId : requestId;

    if (hasOut) {
      // รวม SKU ซ้ำ
      const map = new Map(); // sku -> qty
      for (const raw of addOutItems) {
        const sku = String(raw.sku || '').trim();
        const qty = Number(raw.quantity) || 0;
        if (!sku || qty <= 0) continue;
        map.set(sku, (map.get(sku) || 0) + qty);
      }
      const toIssue = Array.from(map.entries()).map(([sku, quantity]) => ({ sku, quantity }));

      if (toIssue.length === 0) {
        return res.status(400).json({ message: 'Invalid OUT items.' });
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // ตรวจว่ามีสินค้า + กันสต็อกติดลบ (ถ้าไม่ต้องการกัน ตัดบล็อกนี้ทิ้งได้)
          const missing = [];
          const shortage = [];
          for (const it of toIssue) {
            const prod = await Product.findOne({
              sku: it.sku,
              active: { $ne: false }
            })
              .session(session)
              .select('quantity');
            if (!prod) {
              missing.push(it.sku);
              continue;
            }
            const remain = Number(prod.quantity || 0) - Number(it.quantity || 0);
            if (remain < 0) shortage.push({ sku: it.sku, lack: Math.abs(remain) });
          }
          if (missing.length > 0) {
            throw { status: 400, message: `ไม่พบสินค้าในระบบ หรือ SKU ถูกปิดใช้งาน: ${missing.join(', ')}` };
          }
          if (shortage.length > 0) {
            const msg = shortage.map(s => `${s.sku} (ขาด ${s.lack})`).join(', ');
            throw { status: 400, message: `สต็อกไม่พอ: ${msg}` };
          }

          // ตัดสต็อก
          for (const it of toIssue) {
            await Product.updateOne(
              { sku: it.sku },
              { $inc: { quantity: -Number(it.quantity) } },
              { session }
            );
          }

          // บันทึก Transaction OUT
          const first = txs[0];
          const statusForOut = workStatus || first.workStatus || 'Pending';
          const finishDateForOut =
            statusForOut === 'Finish'
              ? (first.finishDate || new Date())
              : null;

          await Transaction.create([{
            requesterName: requesterName || first.requesterName,
            requestId: targetRequestId,
            storeId: (Number.isFinite(parseInt(storeId, 10)) ? parseInt(storeId, 10) : currentStoreId),
            transactionType: 'OUT',
            workStatus: statusForOut,
            finishDate: finishDateForOut,
            username: (req.user && req.user.username) ? req.user.username : 'system',
            products: toIssue.map(i => ({ sku: i.sku, quantity: i.quantity })),
          }], { session });
        });

        const issuedCount = addOutItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        additionalOutResult = {
          issuedCount,
          totalSkus: (new Set(addOutItems.map(i => String(i.sku || '').trim()))).size
        };
        } catch (e) {
          if (e && e.status) {
            return res.status(e.status).json({ message: e.message });
          }

          console.error('Additional OUT failed:', e);

          return res.status(500).json({
            message: e?.message || 'Internal Server Error'
          });
        } finally {
          session.endSession();
        }
    }
    // ============ END ADDITIONAL OUT FLOW ==============

    // =================== NORMAL UPDATE FLOW ====================
    const currentStatus = txs[0].workStatus;
    const now = new Date();

    const updateFields = {
      workStatus,
      updatedAt: now,
    };

    if (currentStatus !== 'Finish' && workStatus === 'Finish') {
      updateFields.finishDate = now;
    }

    if (currentStatus === 'Finish' && workStatus === 'Pending') {
      updateFields.finishDate = null;
    }

    if (requesterName) updateFields.requesterName = requesterName;

    if (storeId) {
      const cleanStoreId = parseInt(storeId, 10);
      if (!Number.isFinite(cleanStoreId)) {
        return res.status(400).json({ message: 'รูปแบบ Store ID ไม่ถูกต้อง' });
      }
      const storeExists = await Store.findOne({ storeId: cleanStoreId }).lean();
      if (!storeExists) {
        return res.status(400).json({ message: 'Store ID นี้ไม่มีอยู่ในระบบ' });
      }
      updateFields.storeId = cleanStoreId;
    }

    if (newRequestId && newRequestId !== requestId) {
      updateFields.requestId = newRequestId;
    }

    const result = await Transaction.updateMany({ requestId }, { $set: updateFields });

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: 'No transactions found to update.' });
    }

    // สร้างข้อความสรุป
    let chunks = [];
    if (partialReturnResult) {
      const piecesLabel = partialReturnResult.returnedCount === 1 ? 'piece' : 'pieces';
      const itemsLabel  = partialReturnResult.totalSkus === 1 ? 'item' : 'items';
      chunks.push(`Returned ${partialReturnResult.returnedCount} ${piecesLabel} (${partialReturnResult.totalSkus} ${itemsLabel})`);
    }
    if (additionalOutResult) {
      const piecesLabel = additionalOutResult.issuedCount === 1 ? 'piece' : 'pieces';
      const itemsLabel  = additionalOutResult.totalSkus === 1 ? 'item' : 'items';
      chunks.push(`Issued ${additionalOutResult.issuedCount} ${piecesLabel} (${additionalOutResult.totalSkus} ${itemsLabel})`);
    }
    chunks.push('Updated successfully');

    return res.json({
      message: chunks.join('. ') + '.',
      modifiedCount: result.modifiedCount,
      newRequestId: (newRequestId && newRequestId !== requestId) ? newRequestId : null,
      returned: partialReturnResult ? partialReturnResult.toReturn : undefined
    });
    // ================= END NORMAL UPDATE FLOW =================
  } catch (error) {
    console.error('Error updating:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});


router.get('/public-workorder/:requestId', async (req, res) => {
  const requestId = decodeURIComponent(req.params.requestId || '');
  try {
    res.set('Cache-Control', 'no-store'); // กัน cache ข้อมูลอ่อนไหว

    const transactions = await Transaction.aggregate([
      { $match: { requestId } },
      { $unwind: '$products' },
      {
        $lookup: {
          from: 'products',
          localField: 'products.sku',
          foreignField: 'sku',
          as: 'productInfo'
        }
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'stores',
          localField: 'storeId',
          foreignField: 'storeId',
          as: 'storeInfo'
        }
      },
      { $unwind: { path: '$storeInfo', preserveNullAndEmptyArrays: true } },

      // ✅ เพิ่ม cost จาก productInfo
      {
        $group: {
          _id: '$_id',
          requesterName:   { $first: '$requesterName' },
          requestId:       { $first: '$requestId' },
          createdAt:       { $first: '$createdAt' },
          updatedAt:       { $first: '$updatedAt' },
          transactionType: { $first: '$transactionType' },
          workStatus:      { $first: '$workStatus' },
          storeId:         { $first: '$storeId' },
          storename:       { $first: '$storeInfo.storename' },
          products: {
            $push: {
              sku: '$products.sku',
              quantity: '$products.quantity',
              description: '$productInfo.description',
              cost: '$productInfo.cost' // ✅ เพิ่มตรงนี้
            }
          }
        }
      },
      { $sort: { createdAt: 1 } }
    ]);

    if (!transactions?.length)
      return res.status(404).send('No transactions found for this Request ID');

    // format เวลาแบบเดิม
    const dayjs = require('dayjs');
    const utc = require('dayjs/plugin/utc');
    const tz = require('dayjs/plugin/timezone');
    dayjs.extend(utc);
    dayjs.extend(tz);

    transactions.forEach(tx => {
      tx.createdAtFormatted = tx.createdAt
        ? dayjs(tx.createdAt).tz('Asia/Bangkok').format('DD MMM YYYY, HH:mm')
        : '-';
      tx.updatedAtFormatted = tx.updatedAt
        ? dayjs(tx.updatedAt).tz('Asia/Bangkok').format('DD MMM YYYY, HH:mm')
        : '-';
    });

    res.render('work-detail-public', { transactions, requestId });
  } catch (e) {
    console.error('public-workorder error:', e);
    res.status(500).send('Internal Server Error');
  }
});



router.get('/get-product-details', (req, res) => {
  const sku = req.query.sku;

  Product.findOne(
    {
      sku: sku,
      active: { $ne: false }
    },
    'description cost',
    (err, product) => {

      if (err) {
        return res.status(500).send('Error fetching product details');
      }

      if (product) {
        res.json({ product });
      } else {
        res.json({ product: null });
      }
    }
  );
});



router.get("/get-store-name", isAuthenticated, async (req, res) => {
  try {
    const rawStoreId = String(req.query.storeId || "").trim();
    const storeIdNum = Number(rawStoreId);

    if (!rawStoreId || Number.isNaN(storeIdNum)) {
      return res.status(400).json({
        error: "Invalid storeId"
      });
    }

    const store = await Store.findOne({ storeId: storeIdNum });

    if (!store) {
      return res.status(404).json({
        error: "Store not found"
      });
    }

    res.json({
      storename: store.storename || store.storeName || store.name || ""
    });
  } catch (error) {
    console.error("Error fetching store name:", error);
    res.status(500).json({
      error: "Server error"
    });
  }
});


router.get("/get-transaction-details", async (req, res) => {
  try {
    const { repair } = req.query;

    if (!repair) {
      return res.status(400).json({ error: 'กรุณาระบุเลขที่ใบเบิก' });
    }

    // ค้นหาข้อมูล transaction จากเลขที่ใบเบิก
    const transaction = await Transaction.findOne({ requestId: repair });

    if (!transaction) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลใบเบิกนี้' });
    }

    // ดึงข้อมูลที่เกี่ยวข้อง เช่น ชื่อผู้เบิก, สถานะใบงาน, รหัสสาขา
    const store = await Store.findOne({ storeId: transaction.storeId });

    // หากไม่พบข้อมูล store ให้คืนค่าผลลัพธ์เป็นค่าว่าง
    res.status(200).json({
      transaction: {
        requesterName: transaction.requesterName || '',
        workStatus: transaction.workStatus || '',
        storeId: store ? store.storeId : ''
      }
    });
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการค้นหาข้อมูล' });
  }
});

router.get('/get-product-details-in', (req, res) => {
  const sku = req.query.sku;

  Product.findOne(
    { sku },
    'description cost active',
    (err, product) => {

      if (err) {
        return res.status(500).send('Error fetching product details');
      }

      if (product) {
        res.json({ product });
      } else {
        res.json({ product: null });
      }
    }
  );
});

  
router.post("/add_trans-in", isAuthenticated, isAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { name, repair, workStatus, storeId, products } = req.body;
    const nameTrim   = (name || "").trim();
    const repairTrim = (repair || "").trim();
    const storeIdNum = Number(storeId);

    if (!nameTrim || !repairTrim || !storeIdNum || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ alert: "ข้อมูลไม่ครบถ้วน" });
    }

    const store = await Store.findOne({ storeId: storeIdNum }).session(session);
    if (!store) return res.status(404).json({ alert: "ไม่พบรหัสสาขานี้" });

    // ✅ ตรวจว่าชื่อผู้เบิกต้องอยู่ใน Requester และยัง active
    const requesterDoc = await Requester.findOne({ shortName: nameTrim, active: true }).session(session);
    if (!requesterDoc) {
      return res.status(400).json({ alert: `ไม่พบชื่อผู้เบิก "${nameTrim}" ในระบบ หรือถูกปิดใช้งาน` });
    }

    // 🔒 กัน SKU ซ้ำ (เพิ่มใหม่)
    const seen = new Set();
    const dups = new Set();
    for (const item of products) {
      const sku = (item?.sku || "").trim().toUpperCase();
      if (!sku) continue;
      if (seen.has(sku)) dups.add(sku);
      else seen.add(sku);
    }
    if (dups.size > 0) {
      return res.status(400).json({
        alert: `พบรหัสสินค้าในคำสั่งนี้ซ้ำกัน: ${[...dups].join(', ')}\nโปรดรวมให้เหลือรหัสละ 1 แถวก่อนบันทึก`
      });
    }

    // ✅ ตรวจรายการสินค้า
    const invalidMessages = [];
    for (const item of products) {
      const sku = (item?.sku || "").trim();
      const qty = Number(item?.quantity);
      if (!sku) { invalidMessages.push("พบ SKU ว่าง"); continue; }
      if (!Number.isFinite(qty) || qty <= 0) {
        invalidMessages.push(`SKU: ${sku} → จำนวนต้องมากกว่า 0`);
        continue;
      }
      const product = await Product.findOne({ sku }).session(session);
      if (!product) invalidMessages.push(`ไม่พบสินค้า SKU: ${sku}`);
    }

    if (invalidMessages.length > 0) {
      return res.status(400).json({
        alert: `พบข้อผิดพลาดในรายการสินค้า<br>${invalidMessages.join("<br>")}`
      });
    }

    // ✅ เพิ่ม stock
    for (const item of products) {
      const sku = item.sku.trim();
      const quantity = Number(item.quantity);
      await Product.updateOne({ sku }, { $inc: { quantity } }, { session });
    }

    // ✅ บันทึก transaction
    const status = workStatus || "Pending";
    const now = new Date();

    await Transaction.create([{
      requesterName: nameTrim,
      requestId: repairTrim,
      transactionType: "IN",
      workStatus: status,
      finishDate: status === "Finish" ? now : null,
      storeId: storeIdNum,
      products: products.map(p => ({ 
        sku: p.sku.trim(), 
        quantity: Number(p.quantity) 
      })),
      username: req.user.username,
    }], { session });

    // ✅ Sync workStatus สำหรับ requestId เดียวกัน
    const syncFields = {
      workStatus: status,
      updatedAt: now
    };

    if (status === "Finish") {
      syncFields.finishDate = now;
    } else if (status === "Pending") {
      syncFields.finishDate = null;
    }

    await Transaction.updateMany(
      { requestId: repairTrim },
      { $set: syncFields },
      { session }
    );

    await session.commitTransaction();
    return res.status(200).json({ message: "บันทึกข้อมูลเรียบร้อยแล้ว" });
  } catch (error) {
    await session.abortTransaction();
    console.error("❌ /add_trans-in:", error);
    return res.status(500).json({ alert: "ไม่สามารถบันทึกข้อมูลได้" });
  } finally {
    session.endSession();
  }
});


router.post('/add_trans-out', isAuthenticated, isAdmin, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { name, repair, workStatus, storeId, products } = req.body;
    const nameTrim = (name || "").trim();
    const repairTrim = (repair || "").trim();
    const storeIdNum = Number(storeId);

    // ✅ ตรวจสอบข้อมูลเบื้องต้น
    if (
      !nameTrim ||
      !repairTrim ||
      !storeIdNum ||
      !Array.isArray(products) ||
      products.length === 0
    ) {
      return res.status(400).json({ alert: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    const store = await Store.findOne({ storeId: storeIdNum }).session(session);
    if (!store) {
      return res.status(404).json({ alert: "ไม่พบรหัสสาขานี้" });
    }

    // ✅ ตรวจว่าชื่อผู้เบิกต้องอยู่ใน Requester และยัง active
    const requesterDoc = await Requester.findOne({
      shortName: nameTrim,
      active: true
    }).session(session);

    if (!requesterDoc) {
      return res.status(400).json({
        alert: `ไม่พบชื่อผู้เบิก "${nameTrim}" ในระบบ หรือถูกปิดใช้งาน`
      });
    }

    // ✅ เช็ค transaction เดิมของเลข repair นี้
    // ถ้าใบงานเดิมเป็น Finish แล้วมีการ OUT เพิ่ม จะให้ transaction ใหม่นับเข้า report ด้วย
    const existingTx = await Transaction.findOne({ requestId: repairTrim })
      .sort({ createdAt: -1 })
      .session(session);

    const status = workStatus || existingTx?.workStatus || "Pending";
    const finishDateValue =
      status === "Finish"
        ? (existingTx?.finishDate || new Date())
        : null;

    // 🔒 กัน SKU ซ้ำ
    const seen = new Set();
    const dups = new Set();

    for (const item of products) {
      const sku = (item?.sku || "").trim().toUpperCase();
      if (!sku) continue;

      if (seen.has(sku)) {
        dups.add(sku);
      } else {
        seen.add(sku);
      }
    }

    if (dups.size > 0) {
      return res.status(400).json({
        alert: `พบรหัสสินค้าในคำสั่งนี้ซ้ำกัน: ${[...dups].join(", ")}\nโปรดรวมให้เหลือรหัสละ 1 แถวก่อนบันทึก`
      });
    }

    // ✅ ตรวจสอบสินค้าและ stock ก่อน
    const insufficientStock = [];

    for (const item of products) {
      const sku = (item?.sku || "").trim();
      const quantity = Number(item?.quantity);

      if (!sku || !Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({
          alert: `SKU: ${sku || "ไม่ระบุ"} → จำนวนไม่ถูกต้อง`
        });
      }

      const product = await Product.findOne({
        sku,
        active: { $ne: false }
      }).session(session);

      if (!product) {
        return res.status(404).json({
          alert: `ไม่พบสินค้า SKU: ${sku} หรือสินค้านี้ถูกปิดใช้งาน`
        });
      }

      if ((product.quantity || 0) < quantity) {
        insufficientStock.push({
          sku,
          available: product.quantity || 0
        });
      }
    }

    if (insufficientStock.length > 0) {
      const alertMessage = insufficientStock
        .map(item => `SKU: ${item.sku} คงเหลือ: ${item.available}`)
        .join("<br>");

      return res.status(400).json({
        alert: `สินค้าบางรายการมีจำนวนไม่เพียงพอ<br>${alertMessage}`
      });
    }

    // ✅ ตัดสต็อก
    for (const item of products) {
      const sku = item.sku.trim();
      const quantity = Number(item.quantity);

      await Product.updateOne(
        {
          sku,
          active: { $ne: false }
        },
        {
          $inc: { quantity: -quantity }
        },
        { session }
      );
    }

    // ✅ บันทึก transaction OUT
    await Transaction.create([{
      requesterName: nameTrim,
      requestId: repairTrim,
      transactionType: "OUT",
      workStatus: status,
      finishDate: finishDateValue,
      storeId: storeIdNum,
      products: products.map(p => ({
        sku: p.sku.trim(),
        quantity: Number(p.quantity)
      })),
      username: req.user.username
    }], { session });

    await session.commitTransaction();

    return res.status(200).json({
      message: "บันทึกข้อมูลเรียบร้อยแล้ว"
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ /add_trans-out:', error);

    return res.status(500).json({
      alert: 'ไม่สามารถบันทึกข้อมูลได้'
    });

  } finally {
    session.endSession();
  }
});




router.get('/edit-product', isAuthenticated, isAdmin, async (req, res) => {
  const rawQuery = (req.query.search ?? '').trim();

  // Escape อักขระพิเศษของ regex ทั้งหมด รวมถึง backslash เอง
  const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // สร้าง filter อย่างปลอดภัย
  let filter = {};
  if (rawQuery) {
    const safe = escapeRegex(rawQuery);
    const regex = new RegExp(safe, 'i'); // case-insensitive
    filter = { $or: [{ sku: regex }, { description: regex }] };
  }

  try {
    // ใช้ collation ช่วยให้ sort ไม่สนตัวพิมพ์เล็ก/ใหญ่
    const products = await Product.find(filter)
      .collation({ locale: 'en', strength: 2 })
      .sort({ sku: 1 })
      .lean()
      .exec();

    res.render('edit-product', { products, search: rawQuery });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).send('Internal Server Error');
  }
});



router.get("/add-product", isAuthenticated, isAdmin, async (req, res) => {
  try {
    let machineTypeOptions = await Product.distinct("machineTypes");
    machineTypeOptions = (machineTypeOptions || [])
      .filter(Boolean)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

    res.render("add-product", {
      success: false,
      error: false,
      duplicate: false,
      sku: "",
      machineTypeOptions   // ✅ ส่งไป EJS
    });
  } catch (err) {
    console.error("Error loading add-product form:", err);
    res.render("add-product", {
      success: false,
      error: true,
      duplicate: false,
      sku: "",
      machineTypeOptions: []
    });
  }
});



router.post("/add", upload.single("image"), async (req, res) => {
  try {
    let imagePublicId = "";

    if (req.file) {
      const streamUpload = () => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "products",
              public_id: req.body.sku,
              overwrite: true,
              invalidate: true
            },
            (error, result) => {
              if (result) resolve(result);
              else reject(error);
            }
          );
          stream.end(req.file.buffer);
        });
      };

      const result = await streamUpload();
      imagePublicId = result.public_id;
    }

    // ✅ normalize machineTypes
    let machineTypes = req.body["machineTypes[]"] ?? req.body.machineTypes;
    if (typeof machineTypes === "string") {
      machineTypes = machineTypes.split(",").map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(machineTypes)) {
      machineTypes = machineTypes.map(s => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
    } else {
      machineTypes = [];
    }

    // ✅ unique (case-insensitive)
    const seen = new Set();
    machineTypes = machineTypes.filter(mt => {
      const key = mt.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const data = new Product({
      sku: req.body.sku,
      description: req.body.description,
      cost: Number(req.body.cost) || 0,
      image: imagePublicId,
      typeparts: req.body.typeparts,
      machineTypes   // ✅ บันทึก array ลง DB
    });

    await data.save();

    return res.render("add-product", {
      success: true,
      error: false,
      duplicate: false,
      sku: "",
      machineTypeOptions: await Product.distinct("machineTypes") // ส่งกลับเพื่อให้ลิสต์อัพเดต
    });

  } catch (err) {
    console.error("🔴 Error adding product:", err.message);

    let machineTypeOptions = await Product.distinct("machineTypes").catch(() => []);

    if (err.code === 11000) {
      return res.render("add-product", {
        success: false,
        error: false,
        duplicate: true,
        sku: req.body.sku,
        machineTypeOptions
      });
    }

    return res.render("add-product", {
      success: false,
      error: true,
      duplicate: false,
      sku: "",
      machineTypeOptions
    });
  }
});



router.get('/edit-product/:id', isAuthenticated, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.redirect('/edit-product?error=notfound');

    // ดึงรายการ machineTypes ทั้งระบบ (unique + clean + sort)
    let machineTypeOptions = await Product.distinct('machineTypes');
    machineTypeOptions = (machineTypeOptions || [])
      .filter(Boolean)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    const message = req.query.message;
    res.render('edit-form', { product, message, machineTypeOptions });
  } catch (err) {
    console.error("Error loading product:", err);
    res.redirect('/edit-product?error=notfound');
  }
});



router.post('/update', upload.single('image'), isAuthenticated, async (req, res) => {
  try {
    console.log("🟢 Received update request:", req.body);
    const update_id = req.body.update_id;

    if (!update_id || update_id.trim() === "") {
      console.error("🔴 update_id is missing or empty");
      return res.render("edit-form", { product: req.body, message: "error" });
    }

    const product = await Product.findById(update_id);
    if (!product) {
      console.log("🔴 Error: Product not found!");
      return res.redirect('/edit-product?error=notfound');
    }

    // ✅ normalize machineTypes
    // เคสที่มาจาก multi-select (array) หรือ input เดียวคั่นด้วย comma (string)
    let machineTypes = req.body.machineTypes;
    if (typeof machineTypes === 'string') {
      machineTypes = machineTypes
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(machineTypes)) {
      machineTypes = machineTypes
        .map(s => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);
    } else {
      machineTypes = [];
    }
    // unique (case-insensitive)
    const seen = new Set();
    machineTypes = machineTypes.filter(mt => {
      const key = mt.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let updateData = {
      sku: req.body.sku,
      description: req.body.description,
      cost: Number(req.body.cost) || 0,
      typeparts: req.body.typeparts,
      machineTypes // ✅ ใส่เข้าไปใน update
    };

    // ⬇️ ส่วนจัดการภาพ (เหมือนเดิม)
    if (req.file) {
      if (product.image) {
        try { await cloudinary.uploader.destroy(product.image); } catch (err) { console.error(err); }
      }
      const streamUpload = () =>
        new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'products', public_id: req.body.sku, overwrite: true, invalidate: true },
            (error, result) => (result ? resolve(result) : reject(error))
          );
          stream.end(req.file.buffer);
        });
      const result = await streamUpload();
      updateData.image = result.public_id;
    } else {
      updateData.image = product.image;
    }

    console.log("🟢 Updating product with data:", updateData);
    await Product.findByIdAndUpdate(update_id, updateData, { new: true });
    console.log("✅ Update successful!");
    res.redirect(`/edit-product/${update_id}?message=success`);
  } catch (err) {
    console.error("🔴 Error updating product:", err);
    res.render('edit-form', { product: req.body, message: 'error' });
  }
});


router.put('/products/:id/toggle-active', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false });
    }

    product.active = !product.active;
    await product.save();

    res.json({
      success: true,
      active: product.active
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


router.post("/import-excel", isAuthenticated, async (req, res) => {
  // ✅ whitelist และ helper ใช้เฉพาะใน route นี้
  const ALLOWED_MACHINE_TYPES = [
    "Clover", "E2S", "Grind Master", "Macro Tab", "Mastrena I", "Mastrena II",
    "NGO", "Nitro", "Nitro Single", "Oviso", "Other", "Vitamix", "Ditting"
  ];

  function parseMachineTypes(raw) {
    if (raw === undefined || raw === null) return null; // ไม่มีคอลัมน์ → ไม่แตะของเดิม
    const arr = String(raw)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const normalized = arr.map(val => {
      const hit = ALLOWED_MACHINE_TYPES.find(a => a.toLowerCase() === val.toLowerCase());
      return hit || null;
    }).filter(Boolean);

    return [...new Set(normalized)];
  }

  const toNumber2 = (v) => {
    const n = parseFloat(String(v).replace(/,/g, ''));
    if (Number.isNaN(n)) return undefined;
    return Math.round(n * 100) / 100;
  };

  const { data: parts, requesterName, requestId } = req.body;

  try {
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.json({ success: false, message: "No data received." });
    }

    for (const item of parts) {
      if (!item.SKU) continue;

      const sku = String(item.SKU).trim();
      const existingProduct = await Product.findOne({ sku });

      const updateFields = {};
      if (item.Description) updateFields.description = String(item.Description).trim();

      if (item.Type) updateFields.typeparts = String(item.Type).trim();

      if (item.Cost !== undefined && item.Cost !== "") {
        const cost2 = toNumber2(item.Cost);
        if (cost2 !== undefined) updateFields.cost = cost2;
      }

      if (item.Image) updateFields.image = item.Image;

      const mtParsed = parseMachineTypes(item.MachineTypes ?? item.machineTypes);
      if (mtParsed && mtParsed.length) {
        updateFields.machineTypes = mtParsed;
      }

      let importedQuantity = parseInt(item.Quantity);
      if (isNaN(importedQuantity)) importedQuantity = 0;

      if (existingProduct) {
        updateFields.quantity = (existingProduct.quantity || 0) + importedQuantity;
      } else {
        updateFields.quantity = importedQuantity;
      }

      if (importedQuantity > 0) {
        const transaction = new Transaction({
          requesterName: requesterName || "Excel Import",
          requestId: requestId || "Excel Import",
          transactionType: "IN",
          storeId: "903",
          workStatus: "Finish",
          products: [{ sku, quantity: importedQuantity }],
          username: req.user?.username || "system",
          createdAt: new Date()
        });
        await transaction.save();
      }

      await Product.updateOne(
        { sku },
        { $set: updateFields },
        { upsert: true }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Import error:", err.message);
    res.json({ success: false, message: err.message });
  }
});


router.get('/stock-summary',isAuthenticated, async (req, res) => {
  try {
    // ดึงข้อมูล onHand จาก collection products
    const products = await Product.find(
      { active: { $ne: false } },
      'sku description quantity typeparts cost machineTypes'
    );

    // ดึงข้อมูล Pending (รวม OUT - IN)
    const pendingData = await Transaction.aggregate([
      { $match: { workStatus: 'Pending' } },
      { $unwind: '$products' },
      {
        $group: {
          _id: '$products.sku',
          totalOut: {
            $sum: {
              $cond: [{ $eq: ['$transactionType', 'OUT'] }, '$products.quantity', 0]
            }
          },
          totalIn: {
            $sum: {
              $cond: [{ $eq: ['$transactionType', 'IN'] }, '$products.quantity', 0]
            }
          }
        }
      },
      {
        $project: {
          pendingQuantity: { $subtract: ['$totalOut', '$totalIn'] }
        }
      }
    ]);

    // แปลงให้เป็น map เพื่อความเร็วในการค้นหา
    const pendingMap = {};
    pendingData.forEach(item => {
      pendingMap[item._id] = item.pendingQuantity;
    });

    // รวม product กับ pending
    const summary = products.map(product => ({
      sku: product.sku,
      description: product.description,
      type: product.typeparts || '',                 
      cost: typeof product.cost === 'number' ? product.cost : 0,
      onHand: product.quantity,
      pending: pendingMap[product.sku] || 0,
      machineTypes: product.machineTypes || []
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));

    res.render('stock-summary', { summary });
  } catch (error) {
    console.error('Error fetching stock summary:', error);
    res.status(500).send('Internal Server Error');
  }
});


router.get('/get-transactions-summary', isAuthenticated, async (req, res) => {
  const { repair } = req.query;
  try {
    const transactions = await Transaction.aggregate([
      { $match: { requestId: repair } },
      { $unwind: '$products' },
      {
        $lookup: {
          from: 'products',
          localField: 'products.sku',
          foreignField: 'sku',
          as: 'productInfo'
        }
      },
      { $unwind: '$productInfo' },
      {
        $group: {
          _id: '$_id',
          requesterName: { $first: '$requesterName' },
          requestId: { $first: '$requestId' },
          createdAt: { $first: '$createdAt' },
          transactionType: { $first: '$transactionType' },
          workStatus: { $first: '$workStatus' },
          storeId: { $first: '$storeId' },
          products: {
            $push: {
              sku: '$products.sku',
              quantity: '$products.quantity',
              description: '$productInfo.description'
            }
          }
        }
      },
      { $sort: { createdAt: 1 } }
    ]);

    res.json({ transactions });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});


router.get('/requesters', isAuthenticated, isAdmin, (req, res) => {
  res.render('requesters', { user: req.user });
});

router.get('/api/requesters', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { q = '', active, format, page = 1, limit = 50 } = req.query;

    const cond = {};
    if (active === 'true')  cond.active = true;
    if (active === 'false') cond.active = false;

    if (q && q.trim()) {
      const kw = q.trim();
      cond.$or = [
        { shortName: { $regex: kw, $options: 'i' } },
        { aliases:   { $elemMatch: { $regex: kw, $options: 'i' } } }
      ];
    }

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip     = (pageNum - 1) * limitNum;

    const docs = await Requester.find(cond)
      .sort({ shortName: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // โหมดที่ select2 ใช้ (ฟอร์ม IN/OUT)
    if (format === 'select2') {
      return res.json({
        results: docs.map(d => ({ id: d.shortName, text: d.shortName })),
        pagination: { more: docs.length === limitNum }
      });
    }

    // โหมดหน้า admin (ตาราง): ส่ง array ตรง ๆ
    return res.json(docs.map(d => ({
      id: String(d._id),
      shortName: d.shortName,
      aliases: d.aliases || [],
      active: !!d.active
    })));
  } catch (err) {
    console.error('GET /api/requesters error:', err);
    res.status(500).json({ ok:false, message: err.message || 'Internal error' });
  }
});

router.post('/api/requesters', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { shortName, aliases = '', active = true } = req.body;

    if (!shortName || !shortName.trim()) {
      return res.status(400).json({ ok: false, message: 'กรุณากรอก Short Name' });
    }

    const doc = new Requester({
      shortName: shortName.trim(),
      active: !!active,
      aliases: String(aliases)
        .split(',')
        .map(a => a.trim())
        .filter(a => a !== '')
    });

    await doc.save();
    res.json({ ok: true, message: 'เพิ่มผู้เบิกสำเร็จ' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ ok: false, message: 'Short Name ซ้ำในระบบ' });
    }
    console.error('POST /api/requesters error:', err);
    res.status(500).json({ ok: false, message: 'Internal error' });
  }
});

router.patch('/api/requesters/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { shortName, aliases = '', active } = req.body;

    const update = {};
    if (shortName) update.shortName = shortName.trim();
    if (aliases !== undefined) {
      update.aliases = String(aliases)
        .split(',')
        .map(a => a.trim())
        .filter(a => a !== '');
    }
    if (active !== undefined) update.active = !!active;

    const doc = await Requester.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ ok: false, message: 'ไม่พบ requester นี้' });

    res.json({ ok: true, message: 'บันทึกการแก้ไขสำเร็จ' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ ok: false, message: 'Short Name ซ้ำในระบบ' });
    }
    console.error('PATCH /api/requesters/:id error:', err);
    res.status(500).json({ ok: false, message: 'Internal error' });
  }
});

router.post('/api/requesters/:id/toggle', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const doc = await Requester.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, message: 'ไม่พบ requester นี้' });

    doc.active = !doc.active;
    await doc.save();

    res.json({ ok: true, message: 'อัปเดตสถานะเรียบร้อย', active: doc.active });
  } catch (err) {
    console.error('POST /api/requesters/:id/toggle error:', err);
    res.status(500).json({ ok: false, message: 'Internal error' });
  }
});

router.delete('/api/requesters/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const doc = await Requester.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, message: 'ไม่พบ requester นี้' });

    res.json({ ok: true, message: 'ลบสำเร็จ' });
  } catch (err) {
    console.error('DELETE /api/requesters/:id error:', err);
    res.status(500).json({ ok: false, message: 'Internal error' });
  }
});

router.get('/product/:sku', isAuthenticated, async (req, res) => {
  try {
    const { sku } = req.params;

    // 1) ข้อมูลสินค้าไว้เป็นส่วนหัว
    const product = await Product.findOne(
      { sku },
      'sku description typeparts cost machineTypes quantity'
    );
    if (!product) return res.status(404).send('Product not found');

    // 2) รวมใบงาน Pending ของ SKU นี้ + หา storeName
    const rows = await Transaction.aggregate([
      { $match: { workStatus: 'Pending' } },
      { $unwind: '$products' },
      { $match: { 'products.sku': sku } },

      // รวมต่อ requestId + ประเภททรานแซกชัน
      {
        $group: {
          _id: { requestId: '$requestId', transactionType: '$transactionType' },
          qty: { $sum: '$products.quantity' },
          requesterName: { $last: '$requesterName' },
          storeId: { $last: '$storeId' },
          updatedAt: { $last: '$updatedAt' },
          workStatus: { $last: '$workStatus' }
        }
      },

      // รวมกลับมาเป็นหนึ่งแถวต่อ requestId
      {
        $group: {
          _id: '$_id.requestId',
          totalOut: {
            $sum: { $cond: [{ $eq: ['$_id.transactionType', 'OUT'] }, '$qty', 0] }
          },
          totalIn: {
            $sum: { $cond: [{ $eq: ['$_id.transactionType', 'IN'] }, '$qty', 0] }
          },
          requesterName: { $last: '$requesterName' },
          storeId: { $last: '$storeId' },
          updatedAt: { $max: '$updatedAt' },
          workStatus: { $last: '$workStatus' }
        }
      },

      // 🔎 หา store name (รองรับ storeId เป็น string/number และชื่อฟิลด์ storename)
      {
        $lookup: {
          from: 'stores',
          let: { sid: '$storeId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$storeId', '$$sid'] },
                    { $eq: [{ $toString: '$storeId' }, { $toString: '$$sid' }] }
                  ]
                }
              }
            },
            { $project: { _id: 0, storename: 1 } }
          ],
          as: 'storeInfo'
        }
      },
      {
        $addFields: {
          storeName: { $ifNull: [{ $arrayElemAt: ['$storeInfo.storename', 0] }, '-' ] }
        }
      },

      // คำนวณ pending
      {
        $project: {
          _id: 0,
          requestId: '$_id',
          requesterName: 1,
          storeId: 1,
          storeName: 1,
          totalOut: 1,
          totalIn: 1,
          pending: { $subtract: ['$totalOut', '$totalIn'] },
          updatedAt: 1,
          workStatus: 1
        }
      },

      // { $match: { pending: { $gt: 0 } } }, // เปิดใช้ถ้าต้องการโชว์เฉพาะที่ค้างจริง ๆ
      { $sort: { updatedAt: -1 } }
    ]);

    // 3) ฟอร์แมตวันที่สำหรับแสดงผล + เก็บ ISO สำหรับ sort ฝั่งตาราง
    rows.forEach(r => {
      r.updatedAtISO = r.updatedAt ? new Date(r.updatedAt).toISOString() : '';
      r.updatedAtFormatted = r.updatedAt
        ? dayjs(r.updatedAt).tz('Asia/Bangkok').format('DD MMM YYYY, HH:mm')
        : '-';
    });

    res.render('product-pending', { product, rows });
  } catch (err) {
    console.error('Error fetching product pending list:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.get("/public-home", async (req, res) => {
  const q = (req.query.q || "").trim();
  const category = (req.query.category || "").trim();

  const filter = {};
  if (category) filter.category = category;
  if (q) filter.title = new RegExp(q, "i");

  const list = await Announcement
    .find(filter)
    .sort({ isPinned: -1, publishedAt: -1 })
    .lean();

  const featured = list[0] || null;
  const posts = list.slice(1);

  res.render("home-public", {
    q,
    category,
    featured,
    posts,
    currentPage: 1,
    totalPages: 1,
    isAdmin: req.session?.user?.role === "admin", // ใช้ตรวจฝั่ง EJS
  });
});

router.get("/public-announcement/:id", async (req, res) => {
  const post = await Announcement.findById(req.params.id).lean();
  if (!post) return res.status(404).render("404", { message: "ไม่พบประกาศ" });

  res.render("announcement-detail", {
    post,
    isAdmin: req.session?.user?.role === "admin",
  });
});

// เพิ่มประกาศ (เฉพาะ admin)
router.post("/api/announcements", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const {
      title,
      excerpt,
      content,
      imageUrl,
      category,
      isPinned,
      isUrgent,
    } = req.body || {};

    if (!title) {
      return res.status(400).json({ ok: false, message: "Title is required" });
    }

    // แปลงค่า checkbox/string ให้เป็น boolean ชัวร์ ๆ
    const toBool = (v) =>
      v === true || v === "true" || v === "on" || v === 1 || v === "1";

    // (ถ้าอยากกัน category นอก enum)
    const allowedCats = ["general", "policy", "urgent"];
    const safeCategory = allowedCats.includes(category) ? category : "general";

    const newDoc = await Announcement.create({
      title,
      excerpt,
      content,
      imageUrl,
      category: safeCategory,
      isPinned: toBool(isPinned),
      isUrgent: toBool(isUrgent),
      author: req.user?.username || "admin",
      publishedAt: new Date(),
    });

    return res.json({ ok: true, data: newDoc });
  } catch (err) {
    console.error("Create announcement error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});


// ลบประกาศ (เฉพาะ admin)
router.delete("/api/announcements/:id", isAuthenticated, isAdmin, async (req, res) => {
  const result = await Announcement.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).json({ ok: false, message: "Not found" });
  res.json({ ok: true });
});

// แก้ไขประกาศ (เฉพาะ admin)
router.put("/api/announcements/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // อนุญาตอัปเดตเฉพาะคีย์เหล่านี้
    const allow = ["title", "excerpt", "content", "imageUrl", "category", "isUrgent", "isPinned", "publishedAt"];
    const patch = {};
    for (const k of allow) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    // เผื่อ client ส่ง boolean มาเป็น string
    if (patch.isUrgent !== undefined) patch.isUrgent = patch.isUrgent === true || patch.isUrgent === "true";
    if (patch.isPinned !== undefined) patch.isPinned = patch.isPinned === true || patch.isPinned === "true";

    const updated = await Announcement.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error("PUT /api/announcements/:id error:", err);
    return res.status(400).json({ ok: false, message: err.message || "Update failed" });
  }
});

router.get("/finished-usage", isAuthenticated, async (req, res) => {
  try {
    const TZ = "Asia/Bangkok";

    // default = เดือนปัจจุบัน
    const startDate = req.query.startDate || dayjs().tz(TZ).startOf("month").format("YYYY-MM-DD");
    const endDate   = req.query.endDate   || dayjs().tz(TZ).endOf("month").format("YYYY-MM-DD");

    const rangeStart = dayjs.tz(startDate, TZ).startOf("day").toDate();
    const rangeEnd   = dayjs.tz(endDate,   TZ).endOf("day").toDate();

    const matchStage = {
      workStatus: "Finish",
      finishDate: { $ne: null, $gte: rangeStart, $lte: rangeEnd }
    };

    const report = await Transaction.aggregate([
      { $match: matchStage },
      { $unwind: "$products" },

      {
        $group: {
          _id: {
            requestId: "$requestId",
            sku: "$products.sku"
          },
          requesterName: { $first: "$requesterName" },
          storeId: { $first: "$storeId" },
          finishDate: { $max: "$finishDate" },

          totalOut: {
            $sum: {
              $cond: [
                { $eq: ["$transactionType", "OUT"] },
                "$products.quantity",
                0
              ]
            }
          },

          totalReturn: {
            $sum: {
              $cond: [
                { $eq: ["$transactionType", "IN"] },
                "$products.quantity",
                0
              ]
            }
          }
        }
      },

      {
        $addFields: {
          usedQty: { $subtract: ["$totalOut", "$totalReturn"] }
        }
      },

      {
        $match: {
          usedQty: { $gt: 0 }
        }
      },

      {
        $lookup: {
          from: "products",
          localField: "_id.sku",
          foreignField: "sku",
          as: "productInfo"
        }
      },
      {
        $unwind: {
          path: "$productInfo",
          preserveNullAndEmptyArrays: true
        }
      },

      // ✅ ดึงชื่อสาขาจาก Store collection
      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "storeId",
          as: "storeInfo"
        }
      },
      {
        $unwind: {
          path: "$storeInfo",
          preserveNullAndEmptyArrays: true
        }
      },

      {
        $project: {
          _id: 0,
          requestId: "$_id.requestId",
          sku: "$_id.sku",
          description: {
            $ifNull: ["$productInfo.description", "N/A"]
          },
          requesterName: 1,
          storeId: 1,

          // ✅ ใช้ชื่อจาก stores
          storename: {
            $ifNull: ["$storeInfo.storename", "-"]
          },

          finishDate: 1,
          totalOut: 1,
          totalReturn: 1,
          usedQty: 1
        }
      },

      { $sort: { finishDate: -1, requestId: 1, sku: 1 } }
    ]);

    res.render("finished-usage", {
      report,
      startDate,
      endDate,
      dayjs
    });

  } catch (error) {
    console.error("Error fetching finished usage report:", error);
    res.status(500).send("Error fetching finished usage report");
  }
});


router.get("/session-check", (req, res) => {
  if (req.session && req.session.user) {
    res.status(200).json({ loggedIn: true });
  } else {
    res.status(401).json({ loggedIn: false, modalMessage: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง" });
  }
});

module.exports = router