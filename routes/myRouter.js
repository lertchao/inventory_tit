const express = require('express')
const router = express.Router()
const Product = require('../models/products')
const Transaction = require('../models/transaction')
const Store = require('../models/store')
const fs = require('fs');
const path = require('path');
const { cloudinary, upload } = require('../config/cloudinary');

const { isAuthenticated, isAdmin } = require("../middleware/auth")
const bcrypt = require("bcrypt")
const User = require("../models/user")

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);


router.get("/register",(req, res) => {
  res.render("register", {
    message: null,
    success: false
  });
});

router.post("/register",async (req, res) => {
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

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render("login", {
        message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
        returnUrl: req.body.returnUrl || "/"
      });
    }

    // ✅ เก็บ user info และ role ลง session
    req.session.user = {
      _id: user._id,
      username: user.username,
      role: user.role
    };

    res.redirect(req.body.returnUrl || "/");
  } catch (error) {
    res.status(500).send("เกิดข้อผิดพลาด");
  }
});


router.get("/logout", (req, res) => {
  req.session.destroy(() => {
      res.redirect("/login");
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
    const today = new Date();
    today.setHours(0, 0, 0, 0); // ตั้งค่าเป็น 00:00:00 ของวันนี้

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
          latestTransactionDate: { $max: "$createdAt" },
        },
      },

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
          latestTransactionDate: { $max: "$latestTransactionDate" },
        },
      },

      {
        $addFields: {
          totalCombinedCost: { $add: ["$cmTotalCost", "$pmTotalCost"] },
        },
      },
      {
        $sort: {
          "_id.requesterName": 1, // เรียงตาม requesterName (A → Z)
          "_id.requestId": 1, // แล้วเรียงตาม requestId (A → Z)
        },
      },
    ]);

    const current = new Date();

    pendingWorkOrdersTable = pendingWorkOrdersTable.map((item) => {
      const latest = item.latestTransactionDate
        ? new Date(item.latestTransactionDate)
        : null;
      const pendingDays = latest
        ? Math.floor((current - latest) / (1000 * 60 * 60 * 24)) // คำนวณห่างกี่วัน
        : null;

      return {
        ...item,
        latestTransactionDate: latest,
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
      { $limit: 10 }
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


router.get('/onhand', isAuthenticated, async (req, res) => {
  const perPage = 12;
  const page = parseInt(req.query.page) || 1;
  const searchQueryRaw = req.query.search || '';

  function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const escapedQuery = escapeRegex(searchQueryRaw);
  const condition = searchQueryRaw ? {
      $or: [
          { sku: { $regex: escapedQuery, $options: 'i' } },
          { description: { $regex: escapedQuery, $options: 'i' } }
      ]
  } : {};

  const total = await Product.countDocuments(condition);
  const products = await Product.find(condition)
      .skip((page - 1) * perPage)
      .limit(perPage);

  res.render('onhand', {
      products,
      search: searchQueryRaw,
      current: page,
      pages: Math.ceil(total / perPage)
  });
});


router.get('/delete/:id',isAuthenticated,(req,res)=>{
    Product.findByIdAndDelete(req.params.id,{useFindAndModify:false}).exec(err=>{
        res.redirect('/edit-product')
    })
})

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
    const searchQuery = req.query.search?.trim() || '';
    const statusFilter = req.query.statusFilter?.trim() || '';
    let matchStage = {};

    if (searchQuery) {
      matchStage.$or = [
        { requestId: { $regex: searchQuery, $options: 'i' } },
        { requesterName: { $regex: searchQuery, $options: 'i' } }
      ];
    }

    if (statusFilter) {
      matchStage.workStatus = statusFilter;
    }

    const groupedTransactions = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$requestId",
          requesterName: { $first: "$requesterName" },
          createdAt: { $last: "$createdAt" },
          workStatus: { $last: "$workStatus" },
          transactionCount: { $sum: 1 },
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    // ✅ เพิ่ม createdAtFormatted
    groupedTransactions.forEach(tx => {
      tx.createdAtFormatted = dayjs(tx.createdAt)
        .tz("Asia/Bangkok")
        .format("DD MMM YYYY, HH:mm");
    });

    res.render('workorder', { 
      transactions: groupedTransactions, 
      searchQuery, 
      statusFilter 
    });

  } catch (error) {
    console.error('Error fetching grouped work orders:', error);
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

    // ✅ เพิ่ม createdAtFormatted
    transactions.forEach(tx => {
      tx.createdAtFormatted = dayjs(tx.createdAt)
        .tz("Asia/Bangkok")
        .format("DD MMM YYYY, HH:mm");
    });

    res.render('work-detail', { transactions, requestId });
  } catch (error) {
    console.error('Error fetching transactions for Request ID:', error);
    res.status(500).send('Internal Server Error');
  }
});


router.put('/workorder/:requestId/update-status', isAuthenticated, async (req, res) => {
  const requestId = decodeURIComponent(req.params.requestId);
  const { workStatus, newRequestId, forceUpdate } = req.body;

  try {
    // ตรวจสอบว่า requestId ใหม่ซ้ำ และไม่ใช่ forceUpdate
    if (newRequestId && newRequestId !== requestId && !forceUpdate) {
      const exists = await Transaction.findOne({ requestId: newRequestId });
      if (exists) {
        return res.status(200).json({
          message: "This Request ID already exists. Do you still want to use it?",
          duplicate: true
        });
      }
    }

    const result = await Transaction.updateMany(
      { requestId },
      {
        $set: {
          workStatus,
          ...(newRequestId && newRequestId !== requestId ? { requestId: newRequestId } : {})
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "No transactions found to update." });
    }

    res.json({
      message: "Updated successfully",
      modifiedCount: result.modifiedCount,
      newRequestId: newRequestId !== requestId ? newRequestId : null
    });
  } catch (error) {
    console.error("Error updating:", error);
    res.status(500).json({ message: "Internal Server Error" });
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
  try {
    const { name, repair, workStatus, storeId, products } = req.body;

    if (!name?.trim() || !repair?.trim() || !storeId?.trim() || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
    }

    const store = await Store.findOne({ storeId: Number(storeId) });
    if (!store) {
      return res.status(404).json({ error: "ไม่พบรหัสสาขานี้" });
    }

    const invalidMessages = [];

    // ตรวจสอบ SKU และ quantity
    for (const item of products) {
      const product = await Product.findOne({ sku: item.sku.trim() });
      if (!product) {
        invalidMessages.push(`ไม่พบสินค้า SKU: ${item.sku}`);
        continue; // ข้ามการตรวจสอบ quantity ถ้าไม่พบสินค้า
      }
      if (!item.quantity || item.quantity <= 0) {
        invalidMessages.push(`SKU: ${item.sku} → จำนวนต้องมากกว่า 0`);
      }
    }

    if (invalidMessages.length > 0) {
      return res.status(400).json({
        error: "พบข้อผิดพลาดในรายการสินค้า",
        alert: invalidMessages.join("<br>"),
      });
    }

    await Transaction.updateMany({ requestId: repair.trim() }, { $set: { workStatus } });

    const newTransaction = new Transaction({
      requesterName: name.trim(),
      requestId: repair.trim(),
      transactionType: "IN",
      workStatus,
      storeId: Number(storeId),
      products: products.map((p) => ({
        sku: p.sku.trim(),
        quantity: Number(p.quantity)
      })),
      username: req.user.username,
    });

    // อัปเดต stock เฉพาะที่ validate ผ่านแล้ว
    for (const item of products) {
      const product = await Product.findOne({ sku: item.sku.trim() });
      product.quantity = (product.quantity || 0) + item.quantity;
      await product.save();
    }

    await newTransaction.save();
    res.status(200).json({ message: "บันทึกข้อมูลเรียบร้อยแล้ว" });

  } catch (error) {
    console.error("Error saving transaction:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
});



router.post('/add_trans-out', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name, repair, workStatus, storeId, products } = req.body;

    // ✅ ตรวจสอบข้อมูลเบื้องต้น
    if (!name || !repair || !storeId || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ alert: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    const store = await Store.findOne({ storeId: Number(storeId) });
    if (!store) {
      return res.status(404).json({ alert: 'ไม่พบรหัสสาขานี้' });
    }

    // ✅ ตรวจสอบ SKU และจำนวนก่อนบันทึก
    const insufficientStock = [];

    for (const item of products) {
      const sku = item.sku ? item.sku.trim() : '';
      const quantity = Number(item.quantity);

      // ✅ ตรวจสอบว่าใส่ SKU หรือไม่
      if (!sku) {
        return res.status(400).json({
          alert: `พบ SKU ที่ไม่ถูกต้อง (ไม่ได้ระบุ)`
        });
      }

      // ✅ ตรวจสอบว่ามีสินค้า SKU นี้หรือไม่
      const product = await Product.findOne({ sku });
      if (!product) {
        return res.status(404).json({
          alert: `ไม่พบสินค้า SKU: ${sku}`
        });
      }

      // ✅ ตรวจสอบจำนวนที่มากกว่า 0
      if (isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({
          alert: `SKU: ${sku} → จำนวนต้องมากกว่า 0`
        });
      }

      // ✅ ตรวจสอบว่าคงเหลือพอหรือไม่
      if ((product.quantity || 0) < quantity) {
        insufficientStock.push({ sku, available: product.quantity || 0 });
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

    // ✅ อัปเดตสถานะใบงาน
    await Transaction.updateMany({ requestId: repair }, { $set: { workStatus } });

    // ✅ บันทึก Transaction ใหม่
    const newTransaction = new Transaction({
      requesterName: name.trim(),
      requestId: repair.trim(),
      transactionType: 'OUT',
      workStatus,
      storeId: Number(storeId),
      products: products.map(p => ({
        sku: p.sku.trim(),
        quantity: Number(p.quantity)
      })),
      username: req.user.username,
    });

    // ✅ ตัดสต็อกสินค้า
    for (const item of products) {
      const product = await Product.findOne({ sku: item.sku.trim() });
      product.quantity -= Number(item.quantity);
      try {
        await product.save();
      } catch (err) {
        console.error("❌ บันทึกสินค้า SKU ผิดพลาด:", item.sku, err);
        return res.status(500).json({ alert: `บันทึก SKU ${item.sku} ผิดพลาด` });
      }
    }

    await newTransaction.save();
    res.status(200).json({ message: 'บันทึกข้อมูลเรียบร้อยแล้ว' });

  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาดใน /add_trans-out:', error);
    res.status(500).json({ alert: 'ไม่สามารถบันทึกข้อมูลได้' });
  }
});




router.get('/edit-product', isAuthenticated,isAdmin, (req, res) => {
  const searchQuery = req.query.search || ''; // รับค่าที่ผู้ใช้กรอกมา (ถ้ามี)

  // สร้างเงื่อนไขการค้นหาสำหรับ sku และ description
  const searchCondition = {
      $or: [
          { sku: { $regex: searchQuery, $options: 'i' } }, 
          { description: { $regex: searchQuery, $options: 'i' } }
      ]
  };

  Product.find(searchQuery ? searchCondition : {}).sort({ sku: 1 }).exec((err, products) => { 
      // เพิ่ม `.sort({ sku: 1 })` เพื่อเรียง SKU จาก A-Z
      if (err) {
          console.error('Error fetching products:', err);
          return res.status(500).send('Internal Server Error');
      }

      // ส่งข้อมูลไปยัง view พร้อมกับข้อมูล products และ search query
      res.render('edit-product', { products: products, search: searchQuery });
  });
});


router.get('/add-product', isAuthenticated,isAdmin, (req, res) => {
    res.render('add-product', { success: null, error: null }); 
});


router.post("/add", upload.single("image"), async (req, res) => {
  try {
    let imagePublicId = "";

    if (req.file) {
      // 📤 อัปโหลดรูปไป Cloudinary
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'products',
        public_id: req.body.sku,
        overwrite: true,
        invalidate: true
      });

      imagePublicId = result.public_id; // เช่น "products/DM123456"

      // 🧹 ลบไฟล์ local หลัง upload
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("⚠️ Failed to delete local file:", err);
        else console.log("🧹 Local file deleted:", req.file.path);
      });
    }

    const data = new Product({
      sku: req.body.sku,
      description: req.body.description,
      cost: req.body.cost,
      image: imagePublicId, // ✅ เก็บ public_id
      typeparts: req.body.typeparts,
    });

    await data.save();
    console.log("✅ Product added:", data);
    res.render("add-product", { success: true, error: false });

  } catch (err) {
    console.error("🔴 Error adding product:", err);
    res.render("add-product", { success: false, error: true });
  }
});


router.post('/edit',isAuthenticated, (req, res) => {
    const edit_id = req.body.edit_id
    Product.findOne({_id:edit_id}).exec((err,doc)=>{
        res.render('edit-form',{product:doc})
    })
})



router.post('/update', upload.single('image'), isAuthenticated, async (req, res) => {
  try {
    console.log("🟢 Received update request:", req.body);

    const update_id = req.body.update_id;

    let updateData = {
      sku: req.body.sku,
      description: req.body.description,
      cost: req.body.cost,
      typeparts: req.body.typeparts
    };

    const product = await Product.findById(update_id);
    if (!product) {
      console.log("🔴 Error: Product not found!");
      return res.render('edit-form', { product: updateData, message: 'error' });
    }

    console.log("🟢 Found product:", product);

    if (req.file) {
      console.log("🟢 Uploaded file (local):", req.file);

      // ลบรูปเก่าออกจาก Cloudinary
      if (product.image) {
        try {
          console.log(`🟡 Deleting old image: ${product.image}`);
          await cloudinary.uploader.destroy(product.image);
        } catch (err) {
          console.error("🔴 Error deleting old image:", err);
        }
      }

      // อัปโหลดรูปใหม่ขึ้น Cloudinary
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'products',
        public_id: req.body.sku,
        overwrite: true,
        invalidate: true
      });

      updateData.image = result.public_id; // เช่น products/DM124011

      // ✅ ลบไฟล์ local หลัง upload สำเร็จ
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("⚠️ Failed to delete local file:", err);
        else console.log("🧹 Local file deleted:", req.file.path);
      });
    } else {
      updateData.image = product.image;
    }

    console.log("🟢 Updating product with data:", updateData);

    const updatedProduct = await Product.findByIdAndUpdate(update_id, updateData, { new: true });

    console.log("✅ Update successful!");
    res.render('edit-form', { product: updatedProduct, message: 'success' });

  } catch (err) {
    console.error("🔴 Error updating product:", err);
    res.render('edit-form', { product: req.body, message: 'error' });
  }
});




router.post("/import-excel",isAuthenticated, async (req, res) => {
  const { data: parts, requesterName, requestId } = req.body;

  try {
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.json({ success: false, message: "No data received." });
    }

    for (const item of parts) {
      if (!item.SKU) continue;

      const sku = item.SKU.trim();
      const existingProduct = await Product.findOne({ sku });

      const updateFields = {};
      if (item.Description) updateFields.description = item.Description.trim();
      if (item.Type) updateFields.typeparts = item.Type.trim();
      if (item.Cost !== undefined && item.Cost !== "") updateFields.cost = parseFloat(item.Cost);
      if (item.Image) updateFields.image = item.Image;

      let importedQuantity = parseInt(item.Quantity);
      if (isNaN(importedQuantity)) importedQuantity = 0;
      
      // กำหนด quantity ให้ product ใหม่ หรือ update
      if (existingProduct) {
        updateFields.quantity = (existingProduct.quantity || 0) + importedQuantity;
      } else {
        updateFields.quantity = importedQuantity;
      }
      
      // ✔ สร้าง Transaction เฉพาะเมื่อ quantity > 0
      if (importedQuantity > 0) {
        const transaction = new Transaction({
          requesterName: requesterName || "Excel Import",
          requestId: requestId || "Excel Import",
          transactionType: "IN",
          workStatus: "Finish",
          products: [
            {
              sku: sku,
              quantity: importedQuantity
            }
          ],
          username: req.user?.username || "system",
          createdAt: new Date()
        });
      
        await transaction.save();
      }
      

      await Product.updateOne(
        { sku: sku },
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
    const products = await Product.find({}, 'sku description quantity');

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
      onHand: product.quantity,
      pending: pendingMap[product.sku] || 0
    }));

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




module.exports = router