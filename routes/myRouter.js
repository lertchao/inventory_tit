const express = require('express')
const router = express.Router()
const Product = require('../models/products')
const Transaction = require('../models/transaction')
const Store = require('../models/store')
const { upload } = require('../config/cloudinary')
const authMiddleware = require("../middleware/auth")
const bcrypt = require("bcrypt")
const User = require("../models/user")


router.get("/register", (req, res) => {
  res.render("register", { message: "" });
});


router.post("/register", async (req, res) => {
  try {
      const { username, password } = req.body;

      const existingUser = await User.findOne({ username });
      if (existingUser) {
          return res.render("register", { message: "ชื่อผู้ใช้นี้ถูกใช้แล้ว" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new User({ username, password: hashedPassword });
      await newUser.save();

      res.redirect("/login");
  } catch (error) {
      console.error("สมัครสมาชิกผิดพลาด:", error); // 📌 ดู Error ใน Console
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
          return res.render("login", { message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", returnUrl: req.body.returnUrl || "/" });
      }

      req.session.user = { username };
      
      // 📌 Redirect ไปยังหน้าที่ผู้ใช้พยายามเข้า (ถ้ามี)
      res.redirect(req.body.returnUrl);
  } catch (error) {
      res.status(500).send("เกิดข้อผิดพลาด");
  }
});


router.get("/logout", (req, res) => {
  req.session.destroy(() => {
      res.redirect("/login");
  });
});

router.get('/', async (req, res) => {
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

    const pendingWorkOrdersTable = await Transaction.aggregate([
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
    
      // 🔹 JOIN storeId -> storename
      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "storeId",
          as: "storeInfo",
        },
      },
      { $unwind: { path: "$storeInfo", preserveNullAndEmptyArrays: true } },
    
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
                then: { $multiply: ["$products.quantity", "$productInfo.cost"] },
                else: { $multiply: ["$products.quantity", "$productInfo.cost", -1] },
              },
            },
          },
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
              $cond: { if: { $eq: ["$_id.typeparts", "CM"] }, then: "$totalCost", else: 0 },
            },
          },
          pmTotalCost: {
            $sum: {
              $cond: { if: { $eq: ["$_id.typeparts", "PM"] }, then: "$totalCost", else: 0 },
            },
          },
        },
      },
      {
        $addFields: {
          totalCombinedCost: { $add: ["$cmTotalCost", "$pmTotalCost"] },
        },
      },
      { $sort: { "_id.requesterName": 1 } },
    ]);
    


    res.render("index", {
      pendingWorkOrders,
      searchQuery,
      partsMovementToday,
      pendingWorkOrdersTable, // ส่งข้อมูล Parts Movement ไปยัง Frontend
    });
  } catch (error) {
    console.error('Error fetching work orders:', error);
    res.status(500).send('Internal Server Error');
  }
});


router.get('/trans-in',authMiddleware,(req,res)=>{
    res.render('trans-in')
})

router.get('/trans-out',authMiddleware,(req,res)=>{
    res.render('trans-out')
})


router.get('/onhand', (req, res) => {
    const searchQuery = req.query.search || ''; // รับค่าที่ผู้ใช้กรอกมา (ถ้ามี)

    // สร้างเงื่อนไขการค้นหา
    const searchCondition = {
        $or: [
            { sku: { $regex: searchQuery, $options: 'i' } }, 
            { description: { $regex: searchQuery, $options: 'i' } } 
        ]
    };

    Product.find(searchQuery ? searchCondition : {}).exec((err, doc) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Internal Server Error');
        }

        res.render('onhand', { products: doc, search: searchQuery });
    });
});


router.get('/delete/:id',(req,res)=>{
    Product.findByIdAndDelete(req.params.id,{useFindAndModify:false}).exec(err=>{
        res.redirect('/edit-product')
    })
})

router.get("/transaction", async (req, res) => {
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

        // คำนวณคงเหลือ
        if (!skuBalances[sku]) skuBalances[sku] = 0; // เริ่มต้นที่ 0
        if (transaction.transactionType === "IN") {
          skuBalances[sku] += product.quantity; // เพิ่มจำนวนถ้าเป็น IN
        } else if (transaction.transactionType === "OUT") {
          skuBalances[sku] -= product.quantity; // ลดจำนวนถ้าเป็น OUT
        }

        return {
          ...product,
          description: productsMap[sku]?.description || "N/A",
          remaining: skuBalances[sku], // เพิ่มข้อมูล Remaining Quantity
        };
      });

      return {
        ...transaction,
        products: updatedProducts,
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
        .filter(transaction => transaction.products.length > 0); // กรอง Transaction ที่ไม่มี Products ตรง
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

router.get('/workorder', authMiddleware, async (req, res) => {
  try {
    const searchQuery = req.query.search?.trim() || ''; // รับค่าค้นหา Request ID
    const statusFilter = req.query.statusFilter?.trim() || ''; // รับค่าฟิลเตอร์ Work Status
    let matchStage = {}; // เริ่มต้นเป็นค่าว่าง

    // ถ้ามีการค้นหา Request ID และ ชื่อ
    if (searchQuery) {
      matchStage.$or = [
        { requestId: { $regex: searchQuery, $options: 'i' } }, // ค้นหา requestId (บางส่วน)
        { requesterName: { $regex: searchQuery, $options: 'i' } } // ค้นหา requesterName (บางส่วน)
      ];
    }
    

    // ถ้ามีการกรอง Work Status
    if (statusFilter) {
      matchStage.workStatus = statusFilter;
    }

    // คิวรี่ข้อมูล
    const groupedTransactions = await Transaction.aggregate([
      { $match: matchStage }, // ใช้เงื่อนไข matchStage เพื่อกรองข้อมูล
      {
        $group: {
          _id: "$requestId", // Group by Request ID
          requesterName: { $first: "$requesterName" },
          createdAt: { $last: "$createdAt" },
          workStatus: { $last: "$workStatus" },
          transactionCount: { $sum: 1 },
        },
      },
      { $sort: { createdAt: -1 } }, // เรียงลำดับตามวันที่ล่าสุด
    ]);

    // ส่งค่าฟิลเตอร์กลับไปที่หน้า View
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


router.get('/workorder/:requestId', async (req, res) => {
  const requestId = decodeURIComponent(req.params.requestId); // ถอดรหัส requestId
  try {
    const transactions = await Transaction.aggregate([
      { $match: { requestId } }, // คัดกรองเฉพาะ transaction ที่ตรงกับ requestId
      { $unwind: '$products' },  // แยก subdocument products ออกมาเป็นรายการแยก
      {
        $lookup: {
          from: 'products',           // ชื่อ collection ของ Product
          localField: 'products.sku', // คีย์ใน Transaction.products
          foreignField: 'sku',        // คีย์ใน Product
          as: 'productInfo'           // ผลลัพธ์จากการ join จะอยู่ใน field นี้
        }
      },
      { $unwind: '$productInfo' }, // แยก productInfo ออกมาเป็น object
      {
        $lookup: {
          from: 'stores',           // ชื่อ collection ของ Store
          localField: 'storeId',    // คีย์ใน Transaction ที่จะ join
          foreignField: 'storeId',  // คีย์ใน Store
          as: 'storeInfo'           // ผลลัพธ์จากการ join จะอยู่ใน field นี้
        }
      },
      { $unwind: { path: '$storeInfo', preserveNullAndEmptyArrays: true } }, // แยก storeInfo ออกมาเป็น object
      {
        $group: {
          _id: '$_id', // กลุ่ม transaction เดียวกัน
          requesterName: { $first: '$requesterName' },
          requestId: { $first: '$requestId' },
          createdAt: { $first: '$createdAt' },
          transactionType: { $first: '$transactionType' },
          workStatus: { $first: '$workStatus' },
          storeId: { $first: '$storeId' },
          storename: { $first: '$storeInfo.storename' }, // ดึง storename จาก storeInfo
          products: {
            $push: {
              sku: '$products.sku',
              quantity: '$products.quantity',
              description: '$productInfo.description' // ดึง description จาก Product
            }
          }
        }
      },
      { $sort: { createdAt: 1 } } // จัดเรียงจากเก่าไปใหม่
    ]);

    if (!transactions || transactions.length === 0) {
      return res.status(404).send('No transactions found for this Request ID');
    }

    res.render('work-detail', { transactions, requestId });
  } catch (error) {
    console.error('Error fetching transactions for Request ID:', error);
    res.status(500).send('Internal Server Error');
  }
});



router.put('/workorder/:requestId/update-status', async (req, res) => {
  const requestId = decodeURIComponent(req.params.requestId); // 🔥 ถอดรหัส
  const { workStatus } = req.body;

  try {
    const result = await Transaction.updateMany(
      { requestId },
      { $set: { workStatus } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "No transactions found to update" });
    }

    res.json({ message: "Work Status updated successfully", modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error updating work status:", error);
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


// API ค้นหาชื่อสาขาจาก storeId
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

// API ค้นหาข้อมูลจากเลขที่ใบเบิก
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

  
router.post('/add_trans-in', authMiddleware, async (req, res) => {
  try {
    const { name, repair, workStatus, storeId, products } = req.body;

    // ตรวจสอบว่า request มีข้อมูลครบถ้วน
    if (!name || !repair || !storeId || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }

    // ตรวจสอบว่า storeId มีอยู่จริงในระบบ
    const store = await Store.findOne({ storeId: Number(storeId) });
    if (!store) {
      return res.status(404).json({ error: 'ไม่พบรหัสสาขานี้' });
    }

    // สร้างรายการ Transaction
    const newTransaction = new Transaction({
      requesterName: name,
      requestId: repair,
      transactionType: 'IN',
      workStatus,
      storeId: Number(storeId), // บันทึก storeId
      products: products.map(p => ({
        sku: p.sku,
        quantity: p.quantity
      }))
    });

    // ตรวจสอบและเพิ่มจำนวนสินค้า
    for (const item of products) {
      const product = await Product.findOne({ sku: item.sku });

      if (!product) {
        return res.status(404).json({ error: `ไม่พบสินค้า SKU: ${item.sku}` });
      }

      // อัปเดตจำนวนสินค้า
      product.quantity = (product.quantity || 0) + item.quantity;
      await product.save();
    }

    // บันทึก Transaction
    await newTransaction.save();

    res.status(200).json({ message: 'บันทึกข้อมูลสำเร็จ', transaction: newTransaction });
  } catch (error) {
    console.error('Error saving transaction:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' });
  }
});



router.post("/add_trans-out", authMiddleware, async (req, res) => {
  try {
    const { name, repair, products, workStatus, storeId } = req.body;

    if (!name || !repair || !storeId || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
    }

    const store = await Store.findOne({ storeId: storeId });
    if (!store) {
      return res.status(404).json({ error: "ไม่พบข้อมูลสาขาที่ระบุ" });
    }

    // ตรวจสอบจำนวนสินค้าทั้งหมดก่อน
    const insufficientStock = [];
    for (const item of products) {
      const product = await Product.findOne({ sku: item.sku });

      if (!product) {
        return res.status(404).json({ error: `ไม่พบสินค้า SKU: ${item.sku}` });
      }

      if ((product.quantity || 0) < item.quantity) {
        insufficientStock.push({ sku: item.sku, available: product.quantity || 0 });
      }
    }

    if (insufficientStock.length > 0) {
      const alertMessage = insufficientStock.map(item => `SKU: ${item.sku} คงเหลือ: ${item.available}`).join("<br>");
      return res.status(400).json({
        error: "สินค้าบางรายการมีจำนวนไม่เพียงพอ",
        insufficientStock,
        alert: `สินค้าบางรายการมีจำนวนไม่เพียงพอ<br>${alertMessage}`
      });
    }
    
    

    // หักลบจำนวนสินค้าเมื่อแน่ใจว่ามีเพียงพอทุก SKU
    for (const item of products) {
      const product = await Product.findOne({ sku: item.sku });
      product.quantity -= item.quantity;
      await product.save();
    }

    const newTransaction = new Transaction({
      requesterName: name,
      requestId: repair,
      transactionType: "OUT",
      workStatus,
      storeId: Number(storeId),
      products: products.map((p) => ({
        sku: p.sku,
        quantity: p.quantity,
      })),
    });

    await newTransaction.save();

    res.status(200).json({ message: "บันทึกข้อมูลสำเร็จ", transaction: newTransaction });
  } catch (error) {
    console.error("Error saving transaction:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
});



  

router.get('/edit-product', authMiddleware, (req, res) => {
    const searchQuery = req.query.search || ''; // รับค่าที่ผู้ใช้กรอกมา (ถ้ามี)

    // สร้างเงื่อนไขการค้นหาสำหรับ sku และ description
    const searchCondition = {
        $or: [
            { sku: { $regex: searchQuery, $options: 'i' } }, 
            { description: { $regex: searchQuery, $options: 'i' } }
        ]
    };

    Product.find(searchQuery ? searchCondition : {}).exec((err, products) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Internal Server Error');
        }

        // ส่งข้อมูลไปยัง view พร้อมกับข้อมูล products และ search query
        res.render('edit-product', { products: products, search: searchQuery });
    });
});

router.get('/add-product', authMiddleware, (req, res) => {
    res.render('add-product', { success: null, error: null }); 
});

// router.get('/:id',(req,res)=>{
//     const product_id = req.params.id
//     console.log(product_id);
//     Product.findOne({_id:product_id}).exec((err,doc)=>{
//         res.render('product',{product:doc})
//     })
// })  


router.post("/add", upload.single("image"), async (req, res) => {
  try {
    const data = new Product({
      sku: req.body.sku,
      description: req.body.description,
      cost: req.body.cost,
      image: req.file ? req.file.path : "", // เก็บ URL ของภาพจาก Cloudinary
      typeparts: req.body.typeparts,
    });

    // บันทึกข้อมูลสินค้าในฐานข้อมูล
    await data.save();
    res.render("add-product", { success: true, error: false });
  } catch (err) {
    console.error(err);
    res.render("add-product", { success: false, error: true });
  }
});


router.post('/edit', (req, res) => {
    const edit_id = req.body.edit_id
    Product.findOne({_id:edit_id}).exec((err,doc)=>{
        res.render('edit-form',{product:doc})
    })
})


router.post('/update', upload.single('image'), async (req, res) => {
  try {
      console.log("🟢 Received update request:", req.body); // เช็คค่าที่ได้รับจากฟอร์ม

      const update_id = req.body.update_id;
      let updateData = {
          sku: req.body.sku,
          description: req.body.description,
          cost: req.body.cost,
          typeparts: req.body.typeparts,
      };

      // ค้นหาข้อมูลเดิม
      let product = await Product.findById(update_id);
      if (!product) {
          console.log("🔴 Error: Product not found!");
          return res.render('edit-form', { product: updateData, message: 'error' });
      }

      console.log("🟢 Found product:", product);

      // ตรวจสอบว่าอัปโหลดไฟล์ใหม่หรือไม่
      if (req.file) {
          console.log("🟢 Uploaded file:", req.file);

          if (product.image) {
              try {
                  const publicId = product.image.split('/').pop().split('.')[0];
                  console.log(`🟡 Deleting old image: products/${publicId}`);
                  await cloudinary.uploader.destroy(`products/${publicId}`);
              } catch (deleteError) {
                  console.error("🔴 Error deleting old image:", deleteError);
              }
          }

          updateData.image = req.file.path; // อัปเดตเป็น URL ของรูปใหม่จาก Cloudinary
      } else {
          updateData.image = product.image;
      }

      console.log("🟢 Updating product with data:", updateData);

      // อัปเดตข้อมูลในฐานข้อมูล
      await Product.findByIdAndUpdate(update_id, updateData, { new: true });

      console.log("✅ Update successful!");
      res.render('edit-form', { product: updateData, message: 'success' });

  } catch (err) {
      console.error("🔴 Error updating product:", err);
      res.render('edit-form', { product: req.body, message: 'error' });
  }
});




module.exports = router