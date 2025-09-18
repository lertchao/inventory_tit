const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  storeId: { 
    type: Number, 
    required: true, 
    unique: true },
  storename: { 
    type: String, 
    trim: true, 
    required: true }
  }, 
  { timestamps: true });

// Models
let Store = mongoose.model("Store", storeSchema);

module.exports = Store;
