const mongoose = require('mongoose');


const transactionSchema = new mongoose.Schema({
  requesterName: { type: String, required: true }, // ชื่อผู้ทำรายการ
  requestId: { type: String, required: true },    // รหัสอ้างอิง
  createdAt: { type: Date, default: Date.now },   // วันที่สร้าง
  transactionType: { 
    type: String, 
    enum: ["IN", "OUT"], // ประเภทการทำธุรกรรม (เข้า หรือ ออก)
    required: true 
  },
  products: [
    {
      sku: { type: String, required: true },      // SKU สินค้า
      quantity: { 
        type: Number, 
        required: true, 
        min: [1, 'Quantity must be at least 1']  // ตรวจสอบว่าจำนวนต้องมากกว่า 0
      }
    }
  ],
  workStatus: { type: String, enum: ["Pending", "Finish"]},
  storeId: { type: Number},
  username: { type: String, required: true },
});


let Transaction = mongoose.model("transaction",transactionSchema)

module.exports = Transaction;


//บันทึกข้อ transaction
module.exports.savetransaction=function(model,data){
    model.save(data)
}

