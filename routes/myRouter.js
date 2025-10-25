const express = require('express')
const router = express.Router()
const Product = require('../models/products')
const Transaction = require('../models/transaction')
const Store = require('../models/store')
const Requester = require('../models/requester')
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
  res.render("login", { message: "", returnUrl: req.query.returnUrl || "/" });
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    // ตรวจสอบว่า username/password ถูกต้องไหม
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render("login", {
        message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
        returnUrl: req.body.returnUrl || "/"
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
    res.redirect(req.body.returnUrl || "/");
    
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
    
    const top10Movement = await Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: firstDayOfMonth, $lte: lastDayOfMonth },
          workStatus: "Finish"
        }
      },
      { $unwind: "$products" },
      {
        $group: {
          _id: { sku: "$products.sku", type: "$transactionType" },
          totalQty: { $sum: "$products.quantity" }
        }
      },
      {
        $group: {
          _id: "$_id.sku",
          inQty: {
            $sum: {
              $cond: [{ $eq: ["$_id.type", "IN"] }, "$totalQty", 0]
            }
          },
          outQty: {
            $sum: {
              $cond: [{ $eq: ["$_id.type", "OUT"] }, "$totalQty", 0]
            }
          }
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "sku",
          as: "productInfo"
        }
      },
      { $unwind: "$productInfo" },
      {
        $project: {
          sku: "$_id",
          description: "$productInfo.description",
          totalIssued: "$outQty"
        }
      },
      { $sort: { totalIssued: -1 } }, // ✅ เรียงจากการเบิกมากที่สุด
      { $limit: 15 }
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
      top10Movement,
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
  const condition = {};
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
  const condition = {};
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

router.get('/public-home', async (req,res)=>{
  res.render('home-public')
})

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
    const searchQuery = req.query.search ? req.query.search.trim() : "";

    // ดึงข้อมูล Transaction และเรียงลำดับตามวันที่
    const transactions = await Transaction.find()
      .sort({ createdAt: 1 }) // เรียงตามเวลา เพื่อคำนวณคงเหลือ
      .lean();

    // ดึง SKU ทั้งหมดจาก transactions
    const allSKUs = transactions.flatMap(transaction =>
      transaction.products.map(product => product.sku)
    );

    // ดึงข้อมูล Product โดยใช้ SKU
    const productsMap = await Product.find({ sku: { $in: allSKUs } })
      .lean()
      .then(products =>
        products.reduce((map, product) => {
          map[product.sku] = product;
          return map;
        }, {})
      );

    // คำนวณสินค้า คงเหลือ
    const skuBalances = {}; // ใช้เก็บคงเหลือของ SKU

    const enrichedTransactions = transactions.map(transaction => {
      const updatedProducts = transaction.products.map(product => {
        const sku = product.sku;

        if (!skuBalances[sku]) skuBalances[sku] = 0;
        if (transaction.transactionType === "IN") {
          skuBalances[sku] += product.quantity;
        } else if (transaction.transactionType === "OUT") {
          skuBalances[sku] -= product.quantity;
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
        createdAtFormatted: dayjs(transaction.createdAt)
          .tz("Asia/Bangkok")
          .format("DD MMM YYYY, HH:mm"),
      };
    });

    // กรองตามคำค้นหา (ถ้ามี)
    let filteredTransactions = enrichedTransactions;
    if (searchQuery) {
      filteredTransactions = enrichedTransactions
        .map(transaction => ({
          ...transaction,
          products: transaction.products.filter(product =>
            product.sku.includes(searchQuery)
          ),
        }))
        .filter(transaction => transaction.products.length > 0);
    }

    res.render("transaction", {
      products: filteredTransactions,
      searchQuery,
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).send("Error fetching transactions");
  }
});


router.get('/workorder', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const perPage = 20;
    const page = parseInt(req.query.page) || 1;

    const searchQuery  = (req.query.search || '').trim();
    const statusFilter = (req.query.statusFilter || '').trim();
    const storeIdRaw   = (req.query.storeId || '').trim();

    const matchStage = {};
    const orConds = [];

    // ✅ เงื่อนไขจากช่องคำค้น (requestId / requesterName) แบบไม่ใช้ helper แยก
    if (searchQuery) {
      // escape อักขระพิเศษของ RegExp ให้เรียบร้อยก่อน
      const safe = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');

      orConds.push(
        { requestId:     { $regex: rx } },
        { requesterName: { $regex: rx } }
      );
    }
    if (orConds.length > 0) {
      matchStage.$or = orConds;
    }

    // ✅ เงื่อนไขจากรหัสสาขา (ถ้ากรอกมา)
    if (storeIdRaw) {
      const digits = storeIdRaw.replace(/\D/g, '').slice(0, 3);
      if (digits.length > 0) {
        const storeIdNum = parseInt(digits, 10);
        if (!Number.isNaN(storeIdNum)) {
          matchStage.storeId = storeIdNum;
        }
      }
    }

    if (statusFilter) {
      matchStage.workStatus = statusFilter;
    }

    const result = await Transaction.aggregate([
      { $match: matchStage },
      { $sort: { createdAt: -1 } }, // ให้ $last ได้สถานะล่าสุดจริง
      {
        $facet: {
          total: [
            { $group: { _id: "$requestId" } },
            { $count: "count" }
          ],
          data: [
            {
              $lookup: {
                from: "stores",
                localField: "storeId",
                foreignField: "storeId",
                as: "storeInfo"
              }
            },
            { $unwind: { path: "$storeInfo", preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id: "$requestId",
                requesterName:    { $first: "$requesterName" },
                createdAt:        { $min: "$createdAt" },
                workStatus:       { $last: "$workStatus" },
                transactionCount: { $sum: 1 },
                storeId:          { $last: "$storeId" },
                storeName:        { $last: "$storeInfo.storename" }
              }
            },
            { $sort: { createdAt: -1 } },
            { $skip: (page - 1) * perPage },
            { $limit: perPage }
          ]
        }
      }
    ]);

    const totalDocs = result?.[0]?.total?.[0]?.count || 0;
    const transactions = result?.[0]?.data || [];

    transactions.forEach(tx => {
      tx.createdAtFormatted = dayjs(tx.createdAt)
        .tz('Asia/Bangkok')
        .format('DD MMM YYYY, HH:mm');
    });

    res.render('workorder', {
      transactions,
      searchQuery,
      statusFilter,
      storeId: storeIdRaw,           // ส่งกลับไปเติมในช่อง input
      current: page,
      pages: Math.ceil(totalDocs / perPage),
      limit: perPage
    });

  } catch (err) {
    console.error('Error fetching grouped work orders:', err);
    res.status(500).send('Internal Server Error');
  }
});



router.get('/workorder/:requestId', isAuthenticated, async (req, res) => {
  const requestId = decodeURIComponent(req.params.requestId);
  try {
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
      { $unwind: '$productInfo' },
      {
        $lookup: {
          from: 'stores',
          localField: 'storeId',
          foreignField: 'storeId',
          as: 'storeInfo'
        }
      },
      { $unwind: { path: '$storeInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$_id',
          requesterName: { $first: '$requesterName' },
          requestId: { $first: '$requestId' },
          createdAt: { $first: '$createdAt' },
          updatedAt: { $first: '$updatedAt' }, 
          transactionType: { $first: '$transactionType' },
          workStatus: { $first: '$workStatus' },
          storeId: { $first: '$storeId' },
          storename: { $first: '$storeInfo.storename' },
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

    if (!transactions || transactions.length === 0) {
      return res.status(404).send('No transactions found for this Request ID');
    }

    // ✅ แปลงวันที่สำหรับทุก transaction
    transactions.forEach(tx => {
      tx.createdAtFormatted = tx.createdAt
        ? dayjs(tx.createdAt).tz("Asia/Bangkok").format("DD MMM YYYY, HH:mm")
        : "-";

      tx.updatedAtFormatted = tx.updatedAt
        ? dayjs(tx.updatedAt).tz("Asia/Bangkok").format("DD MMM YYYY, HH:mm")
        : "-";
    });
    
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
    addOutItems = []            // 👈 เพิ่มรับรายการ OUT
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

    // กันไม่ให้ส่ง isCancel + isReturn พร้อมกัน
    if (isCancel && isReturn) {
      return res.status(400).json({ message: 'Cannot perform cancel and partial return in the same request.' });
    }

    // กันไม่ให้ส่ง OUT พร้อม Cancel
    if (isCancel && Array.isArray(addOutItems) && addOutItems.length > 0) {
      return res.status(400).json({ message: 'Cannot add OUT items when canceling the work order.' });
    }

    // ======================= CANCEL FLOW (เดิม) =======================
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
            { $set: { workStatus: 'Cancel', updatedAt: new Date() } },
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
        await session.abortTransaction();
        if (e && e.status) return res.status(e.status).json({ message: e.message });
        console.error('Cancel flow failed:', e);
        return res.status(500).json({ message: 'Internal Server Error' });
      } finally {
        session.endSession();
      }
    }
    // ===================== END CANCEL FLOW =====================

    // ================== PARTIAL RETURN FLOW (เดิม) ==================
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
          await Transaction.create([{
            requesterName: first.requesterName,
            requestId,
            storeId: currentStoreId,
            transactionType: 'IN',
            // ตั้งให้เป็นสถานะที่เลือกอยู่ตอนนี้ เพื่อลดความสับสนของรายงานภาพรวม
            workStatus: (workStatus || first.workStatus || 'Finish'),
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
        await session.abortTransaction();
        if (e && e.status) return res.status(e.status).json({ message: e.message });
        console.error('Partial return failed:', e);
        return res.status(500).json({ message: 'Internal Server Error' });
      } finally {
        session.endSession();
      }
    }
    // ================= END PARTIAL RETURN FLOW =================

    // ============== ADDITIONAL OUT FLOW (ใหม่) =================
    let additionalOutResult = null;
    const hasOut = Array.isArray(addOutItems) && addOutItems.length > 0;
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
            const prod = await Product.findOne({ sku: it.sku }).session(session).select('quantity');
            if (!prod) {
              missing.push(it.sku);
              continue;
            }
            const remain = Number(prod.quantity || 0) - Number(it.quantity || 0);
            if (remain < 0) shortage.push({ sku: it.sku, lack: Math.abs(remain) });
          }
          if (missing.length > 0) {
            throw { status: 400, message: `ไม่พบสินค้าในระบบ: ${missing.join(', ')}` };
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
          await Transaction.create([{
            requesterName: requesterName || first.requesterName,
            requestId: targetRequestId,
            storeId: (Number.isFinite(parseInt(storeId, 10)) ? parseInt(storeId, 10) : currentStoreId),
            transactionType: 'OUT',
            workStatus: (workStatus || first.workStatus || 'Pending'),
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
        await session.abortTransaction();
        if (e && e.status) return res.status(e.status).json({ message: e.message });
        console.error('Additional OUT failed:', e);
        return res.status(500).json({ message: 'Internal Server Error' });
      } finally {
        session.endSession();
      }
    }
    // ============ END ADDITIONAL OUT FLOW (ใหม่) ==============

    // =================== NORMAL UPDATE FLOW (เดิม) ====================
    // เปลี่ยน Request ID → เช็กซ้ำ (ถ้าไม่ force ให้ถาม)
    if (newRequestId && newRequestId !== requestId && !forceUpdate) {
      const exists = await Transaction.findOne({ requestId: newRequestId }).lean();
      if (exists) {
        return res.status(200).json({
          message: 'This Request ID already exists. Do you still want to use it?',
          duplicate: true,
        });
      }
    }

    const updateFields = {
      workStatus,               // 'Pending' | 'Finish'
      updatedAt: new Date(),
    };

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
    const sku = req.query.sku; // รับค่า sku จาก URL
    Product.findOne({ sku: sku }, 'description cost', (err, product) => {
      if (err) {
        return res.status(500).send('Error fetching product details');
      }
  
      if (product) {
        res.json({ product }); // ส่งข้อมูล product กลับ
      } else {
        res.json({ product: null }); // หากไม่พบสินค้า
      }
    });
  });



router.get("/get-store-name", async (req, res) => {
  try {
    const { storeId } = req.query;
    console.log("Received storeId:", storeId); // Debug: เช็คค่าที่รับมา

    if (!storeId) {
      return res.status(400).json({ error: "กรุณาระบุรหัสสาขา" });
    }

    const store = await Store.findOne({ storeId: Number(storeId) });
    console.log("Store data:", store); // Debug: เช็คค่าที่ดึงจากฐานข้อมูล

    if (!store) {
      return res.status(404).json({ error: "ไม่พบรหัสสาขานี้" });
    }

    res.status(200).json({ storename: store.storename });
  } catch (error) {
    console.error("Error fetching store name:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการค้นหาข้อมูล" });
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
    await Transaction.create([{
      requesterName: nameTrim,
      requestId: repairTrim,
      transactionType: "IN",
      workStatus,
      storeId: storeIdNum,
      products: products.map(p => ({ sku: p.sku.trim(), quantity: Number(p.quantity) })),
      username: req.user.username,
    }], { session });

    // ✅ Sync workStatus สำหรับ requestId เดียวกัน
    await Transaction.updateMany(
      { requestId: repairTrim },
      { $set: { workStatus, updatedAt: new Date() } },
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
    const nameTrim   = (name || "").trim();
    const repairTrim = (repair || "").trim();
    const storeIdNum = Number(storeId);

    // ✅ ตรวจสอบข้อมูลเบื้องต้น
    if (!nameTrim || !repairTrim || !storeIdNum || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ alert: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    const store = await Store.findOne({ storeId: storeIdNum }).session(session);
    if (!store) return res.status(404).json({ alert: "ไม่พบรหัสสาขานี้" });

    // ✅ ตรวจว่าชื่อผู้เบิกต้องอยู่ใน Requester และยัง active
    const requesterDoc = await Requester.findOne({ shortName: nameTrim, active: true }).session(session);
    if (!requesterDoc) {
      return res.status(400).json({ alert: `ไม่พบชื่อผู้เบิก "${nameTrim}" ในระบบ หรือถูกปิดใช้งาน` });
    }

    // 🔒 กัน SKU ซ้ำ (ของเดิมคุณมีอยู่แล้ว — คงไว้)
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
        alert: `พบรหัสสินค้าในคำสั่งนี้ซ้ำกัน: ${[...dups].join(", ")}\nโปรดรวมให้เหลือรหัสละ 1 แถวก่อนบันทึก`,
      });
    }

    // ✅ ตรวจสอบสินค้าก่อน
    const insufficientStock = [];
    for (const item of products) {
      const sku = (item?.sku || "").trim();
      const quantity = Number(item?.quantity);

      if (!sku || !Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ alert: `SKU: ${sku || "ไม่ระบุ"} → จำนวนไม่ถูกต้อง` });
      }

      const product = await Product.findOne({ sku }).session(session);
      if (!product) {
        return res.status(404).json({ alert: `ไม่พบสินค้า SKU: ${sku}` });
      }

      if ((product.quantity || 0) < quantity) {
        insufficientStock.push({ sku, available: product.quantity || 0 });
      }
    }

    if (insufficientStock.length > 0) {
      const alertMessage = insufficientStock.map(item => `SKU: ${item.sku} คงเหลือ: ${item.available}`).join("<br>");
      return res.status(400).json({ alert: `สินค้าบางรายการมีจำนวนไม่เพียงพอ<br>${alertMessage}` });
    }

    // ✅ ตัดสต็อก
    for (const item of products) {
      const sku = item.sku.trim();
      const quantity = Number(item.quantity);
      await Product.updateOne({ sku }, { $inc: { quantity: -quantity } }, { session });
    }

    // ✅ บันทึก transaction
    await Transaction.create([{
      requesterName: nameTrim,
      requestId: repairTrim,
      transactionType: 'OUT',
      workStatus,
      storeId: storeIdNum,
      products: products.map(p => ({ sku: p.sku.trim(), quantity: Number(p.quantity) })),
      username: req.user.username,
    }], { session });

    // ✅ Sync workStatus สำหรับ requestId เดียวกัน
    await Transaction.updateMany(
      { requestId: repairTrim },
      { $set: { workStatus, updatedAt: new Date() } },
      { session }
    );

    await session.commitTransaction();
    return res.status(200).json({ message: "บันทึกข้อมูลเรียบร้อยแล้ว" });
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ /add_trans-out:', error);
    return res.status(500).json({ alert: 'ไม่สามารถบันทึกข้อมูลได้' });
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
    const products = await Product.find({}, 'sku description quantity typeparts cost machineTypes');

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





router.get("/session-check", (req, res) => {
  if (req.session && req.session.user) {
    res.status(200).json({ loggedIn: true });
  } else {
    res.status(401).json({ loggedIn: false, modalMessage: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง" });
  }
});

module.exports = router