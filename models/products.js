const mongoose = require('mongoose')

const productSchema = new mongoose.Schema({
  sku: { 
    type: String, 
    unique: true,   // ต้องไม่ซ้ำ
    required: true  // ต้องกำหนดค่า
  },
  description: { 
    type: String, 
    required: true  // บังคับให้ต้องมีคำอธิบายสินค้า
  },
  cost: { 
    type: Number, 
    required: true, 
    min: [0, 'Cost must be a positive number']
  },
  image: { 
    type: String 
  },
  quantity: { 
    type: Number, 
    default: 0, 
    min: [0, 'Quantity cannot be negative'] 
  },
  typeparts: { type: String, enum: ["CM", "PM"]}
});

//Models
let Product = mongoose.model("products",productSchema)

module.exports = Product

//บันทึกข้อมูลสินค้า
module.exports.saveProduct=function(model,data){
    model.save(data)
}

