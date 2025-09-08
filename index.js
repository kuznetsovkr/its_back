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
require("./bots/orderBot");
require("./models/OrderAttachment");


const app = express();
const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cdek", cdekRoutes);
app.use("/api/user", userRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/upload", uploadRoutes);
app.use('/api/colors', colorsRouter);

// новый, правильный путь (будет работать за Traefik, т.к. у нас префикс /api → API)
app.use('/api/uploads', express.static(UPLOAD_DIR));

// оставить старый путь для обратной совместимости (по желанию)
app.use('/uploads', express.static(UPLOAD_DIR));

const paykeeperRouter = require('./routes/payments.paykeeper');
app.use('/api/payments/paykeeper', paykeeperRouter); // когда префикс сохраняется
app.use('/payments/paykeeper',     paykeeperRouter); // когда префикс срезан


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
