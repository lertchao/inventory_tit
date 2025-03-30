const express = require('express')
const path = require('path')
const mongoose = require('mongoose');
const router = require('./routes/myRouter')
const app = express()
const session = require("express-session");
const MongoStore = require("connect-mongo");


// เชื่อมต่อฐานข้อมูล MongoDB
const dbUrl = 'mongodb+srv://64230092:1234@cluster0.pglvr.mongodb.net/Database'; // URL ของฐานข้อมูล
mongoose.connect(dbUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Database connected successfully');
}).catch(err => {
    console.error('Database connection error:', err);
});

// ตั้งค่า session
app.use(
    session({
      secret: "your_secret_key",
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: dbUrl, 
        collectionName: "sessions",
      }),
      cookie: {
        maxAge: 1000 * 60 * 60, // อายุ session 1 ชั่วโมง
        httpOnly: true,
      },
    })
  );

app.use((req, res, next) => {
  res.locals.user = req.session.user || null; // ให้ตัวแปร `user` ใช้งานได้ทุกหน้า
  next();
});

// Middleware สำหรับ parse JSON
app.use(express.json());
// Middleware สำหรับ parse form-urlencoded
app.use(express.urlencoded({ extended: true }));

app.set('views',path.join(__dirname,'views'))
app.set('view engine', 'ejs')
app.use(express.urlencoded({extended:false}))
app.use(router)
app.use(express.static(path.join(__dirname,'public')))

app.use((req, res) => {
  res.status(404).render("404", { title: "Page Not Found" });
  });


app.listen(8080,()=>{
    console.log("รัน Server ที่ Port 8080")
})