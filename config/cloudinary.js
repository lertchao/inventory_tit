const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

// ตั้งค่า Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ตั้งค่า Storage สำหรับ Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'products', // โฟลเดอร์ใน Cloudinary
    format: async (req, file) => 'png', // บังคับเป็น .png
    public_id: (req, file) => file.originalname.split('.')[0]
  }
});

const upload = multer({ storage });

module.exports = { cloudinary, upload };
