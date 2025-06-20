const cloudinary = require('cloudinary').v2;
const multer = require('multer');
require('dotenv').config();

// ตั้งค่า Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ใช้ memoryStorage แทน diskStorage
const storage = multer.memoryStorage();
const upload = multer({ storage });

module.exports = { cloudinary, upload };
