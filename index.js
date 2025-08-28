require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const sequelize = require("./db");
const cdekRoutes = require("./routes/cdekRoutes");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const colorsRouter = require('./routes/colors');
const cron = require("node-cron");
const { checkAllAndNotify } = require("./services/lowStockMonitor");
require("./models/TelegramSubscriber"); // чтобы sync создал таблицу
require("./bots/lowStockBot");          // запускаем long polling бота


const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cdek", cdekRoutes);
app.use("/api/user", userRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/upload", uploadRoutes);
app.use('/api/colors', colorsRouter);

// Раздаём статические файлы (включая service.php)
app.use(express.static(path.join(__dirname, "public")));

// Делаем service.php доступным по URL http://localhost:5000/service.php
app.get("/service.php", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "service.php"));
});
// 🔹 Делаем папку uploads публичной (чтобы можно было загружать изображения)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const start = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true }); // Обновляем БД, если что-то поменяется

    console.log("✅ Database connected");

        // (Опционально) Разовый прогон при запуске
    checkAllAndNotify().catch(e => console.error("Initial low-stock check error:", e));

        // Крон: каждый час в 09 минут
    cron.schedule("9 * * * *", async () => {
      console.log("⏰ Low-stock cron tick");
      try {
        await checkAllAndNotify();
      } catch (e) {
        console.error("Low-stock cron error:", e);
      }
    });

    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (error) {
    console.error("❌ Database connection error:", error);
  }
};

start();
