const mongoose = require('mongoose')

const productSchema = new mongoose.Schema({
  sku: { 
    type: String, 
    unique: true,
    required: true
  },
  description: { 
    type: String, 
    required: true
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
  typeparts: { 
    type: String, 
    enum: ["CM", "PM"]
  },
  machineTypes: {
    type: [String],
    default: []
  }

}, {
  timestamps: true
});



//Models
let Product = mongoose.model("products",productSchema)

module.exports = Product

//บันทึกข้อมูลสินค้า
module.exports.saveProduct=function(model,data){
    model.save(data)
}

