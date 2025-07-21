const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  requesterName: { type: String, required: true },
  requestId: { type: String, required: true },
  transactionType: {
    type: String,
    enum: ["IN", "OUT"],
    required: true
  },
  products: [
    {
      sku: { type: String, required: true },
      quantity: {
        type: Number,
        required: true,
        min: [1, 'Quantity must be at least 1']
      },
      description: String,
      remaining: Number
    }
  ],
  workStatus: { type: String, enum: ["Pending", "Finish"] },
  storeId: { type: Number },
  storename: String,
  username: { type: String, required: true }
}, {
  timestamps: true // ✅ เปิดใช้งาน createdAt และ updatedAt อัตโนมัติ
});

module.exports = mongoose.model("transaction", transactionSchema);



//บันทึกข้อ transaction
module.exports.savetransaction=function(model,data){
    model.save(data)
}

