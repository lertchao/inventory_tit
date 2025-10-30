const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },                 // หัวข้อประกาศ
  excerpt: { type: String },                               // ข้อความย่อ (optional)
  content: { type: String },                               // เนื้อหา (HTML allowed)
  imageUrl: { type: String },                              // ลิงก์ภาพ (optional)
  category: {                                              // หมวดหมู่
    type: String,
    enum: ["general", "policy", "urgent"],
    default: "general"
  },
  isUrgent: { type: Boolean, default: false },             // ธงแสดงความเร่งด่วน
  isPinned: { type: Boolean, default: false },             // ธงปักหมุด
  author: { type: String, required: true },                // ผู้เขียน/ผู้ประกาศ
  publishedAt: { type: Date, default: Date.now },          // วันเวลาเผยแพร่
}, {
  timestamps: true // สร้าง createdAt / updatedAt ให้อัตโนมัติ
});

module.exports = mongoose.model("Announcement", announcementSchema);
