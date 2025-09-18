const mongoose = require('mongoose');

const requesterSchema = new mongoose.Schema({
  // รหัส/ชื่อย่อที่ใช้ในระบบ (แนะนำให้เป็น key หลักที่คนคุ้นเคย)
  shortName: { type: String, required: true, trim: true, unique: true },

  // เปิด/ปิดใช้งาน (soft delete)
  active: { type: Boolean, default: true },

  // ไว้ map ชื่อเก่า/สะกดผิด ให้ค้นเจอง่ายในอนาคต
  aliases: [{ type: String, trim: true }]
}, { timestamps: true });

// index สำคัญ (กันชื่อซ้ำ + ค้นหาง่าย)
requesterSchema.index({ shortName: 1 }, { unique: true });
requesterSchema.index({ active: 1, shortName: 1 });

module.exports = mongoose.model('Requester', requesterSchema);
