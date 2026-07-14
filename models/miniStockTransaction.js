const mongoose = require('mongoose');

const miniStockTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['TRANSFER', 'USAGE'],
    required: true
  },
  fse: { type: String, required: true },
  sku: { type: String, required: true },
  description: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  workOrderId: { type: String },
  note: { type: String },
  createdBy: { type: String, required: true },
  // USAGE only: has a TRANSFER replenishment been done for this usage?
  replenished: { type: Boolean, default: false },
  replenishedAt: { type: Date },
  replenishedBy: { type: String }
}, { timestamps: true });

miniStockTransactionSchema.index({ fse: 1, sku: 1, type: 1 });
miniStockTransactionSchema.index({ type: 1, replenished: 1 });

module.exports = mongoose.model('MiniStockTransaction', miniStockTransactionSchema);
