// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// ตั้งค่า Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ใช้ diskStorage เก็บไฟล์ก่อนอัปโหลด
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // อย่าลืมสร้างโฟลเดอร์นี้
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, req.body.sku + ext); // ตั้งชื่อไฟล์ตาม SKU
  }
});

const upload = multer({ storage });

module.exports = { cloudinary, upload };
