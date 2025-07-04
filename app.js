const express = require('express')
const path = require('path')
const mongoose = require('mongoose');
const router = require('./routes/myRouter')
const app = express()
const session = require("express-session");
const MongoStore = require("connect-mongo");

//mongodb+srv://64230092:1234@cluster0.pglvr.mongodb.net/
//mongodb://localhost:27017/Database

const dbUrl = 'mongodb+srv://64230092:1234@cluster0.pglvr.mongodb.net'; 
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
  res.locals.user = req.session.user || null;

  res.locals.successMessage = req.session.successMessage;
  delete req.session.successMessage;
  
  next();
});

// Middleware สำหรับ parse JSON และ form-urlencoded พร้อมเพิ่ม limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.set('views',path.join(__dirname,'views'))
app.set('view engine', 'ejs')
//app.use(express.urlencoded({extended:false}))
app.use(router)
app.use(express.static(path.join(__dirname,'public')))

app.use((req, res) => {
  res.status(404).render("404", { title: "Page Not Found" });
  });


app.listen(8080,()=>{
    console.log("รัน Server ที่ Port 8080")
})