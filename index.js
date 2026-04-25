require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const sequelize = require("./db");
const cdekRoutes = require("./routes/cdekRoutes");
const cdekServiceRoutes = require("./routes/cdekServiceRoutes");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const clothingTypeRoutes = require("./routes/clothingTypeRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const colorsRouter = require("./routes/colors");
const { checkAllAndNotify } = require("./services/lowStockMonitor");

require("./models/TelegramSubscriber");
require("./models/OrderAttachment");

const ENABLE_TELEGRAM_BOTS = process.env.ENABLE_TELEGRAM_BOTS === "1";
const ENABLE_LOW_STOCK_CRON = process.env.ENABLE_LOW_STOCK_CRON === "1";

if (ENABLE_TELEGRAM_BOTS) {
  require("./bots/lowStockBot");
  require("./bots/orderBot");
}

const app = express();
const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const FRONTEND_BUILD_DIR =
  process.env.FRONTEND_BUILD_DIR || path.resolve(__dirname, "..", "its_prototype", "build");
const FRONTEND_INDEX_FILE = path.join(FRONTEND_BUILD_DIR, "index.html");

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cdek", cdekRoutes);
app.use("/api/user", userRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/clothing-types", clothingTypeRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/colors", colorsRouter);
app.use(cdekServiceRoutes);

app.use("/api/uploads", express.static(UPLOAD_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

const paykeeperRouter = require("./routes/payments.paykeeper");
app.use("/api/payments/paykeeper", paykeeperRouter);
app.use("/payments/paykeeper", paykeeperRouter);

if (fs.existsSync(FRONTEND_INDEX_FILE)) {
  app.use(express.static(FRONTEND_BUILD_DIR));

  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path === "/api" ||
      req.path.startsWith("/uploads") ||
      req.path.startsWith("/payments/") ||
      req.path === "/service.php"
    ) {
      return next();
    }

    return res.sendFile(FRONTEND_INDEX_FILE);
  });
} else {
  console.warn(`[startup] Frontend build not found: ${FRONTEND_INDEX_FILE}`);
}

const start = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    if (ENABLE_LOW_STOCK_CRON) {
      checkAllAndNotify().catch((e) => console.error("Initial low-stock check error:", e));

      cron.schedule("9 * * * *", async () => {
        try {
          await checkAllAndNotify();
        } catch (e) {
          console.error("Low-stock cron error:", e);
        }
      });
    }

    app.listen(PORT);
  } catch (error) {
    console.error("Database connection error:", error);
  }
};

start();
