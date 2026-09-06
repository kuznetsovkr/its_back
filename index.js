require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const sequelize = require("./db");
const cdekRoutes = require("./routes/cdekRoutes");
const cdekServiceRoutes = require("./routes/cdekServiceRoutes");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const clothingTypeRoutes = require("./routes/clothingTypeRoutes");
const pricingRoutes = require("./routes/pricingRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const fileRoutes = require("./routes/fileRoutes");
const colorsRouter = require("./routes/colors");
const { checkAllAndNotify } = require("./services/lowStockMonitor");
const { clearTemporaryUploads } = require("./lib/uploadSecurity");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  validateTelegramChannelConfig,
} = require("./services/telegramChannels");

require("./models/TelegramChannelSubscriber");
require("./models/OrderAttachment");

const ENABLE_LOW_STOCK_CRON = process.env.ENABLE_LOW_STOCK_CRON === "1";
const ENABLE_DB_ALTER_SYNC = process.env.ENABLE_DB_ALTER_SYNC === "1";
const ENABLE_STARTUP_WARNINGS = process.env.ENABLE_STARTUP_WARNINGS === "1";

const orderTelegramConfig = getTelegramChannelConfig(TELEGRAM_CHANNELS.ORDERS);
const lowStockTelegramConfig = getTelegramChannelConfig(TELEGRAM_CHANNELS.LOW_STOCK);
validateTelegramChannelConfig([orderTelegramConfig, lowStockTelegramConfig]);

if (orderTelegramConfig.enabled) {
  require("./bots/orderBot");
}
if (lowStockTelegramConfig.enabled) {
  require("./bots/lowStockBot");
}

const app = express();
const PORT = process.env.PORT || 5000;
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}
const FRONTEND_BUILD_DIR =
  process.env.FRONTEND_BUILD_DIR || path.resolve(__dirname, "..", "its_prototype", "build");
const FRONTEND_INDEX_FILE = path.join(FRONTEND_BUILD_DIR, "index.html");

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cdek", cdekRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/clothing-types", clothingTypeRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/uploads", fileRoutes);
app.use("/api/colors", colorsRouter);
app.use(cdekServiceRoutes);

app.use("/uploads", (_req, res) => {
  res.status(404).json({ message: "Direct file access is disabled" });
});

const paykeeperRouter = require("./routes/payments.paykeeper");
app.use("/api/payments/paykeeper", paykeeperRouter);
app.use("/payments/paykeeper", paykeeperRouter);

if (fs.existsSync(FRONTEND_INDEX_FILE)) {
  app.use(express.static(FRONTEND_BUILD_DIR));

  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path === "/api" ||
      req.path.startsWith("/payments/") ||
      req.path === "/service.php"
    ) {
      return next();
    }

    return res.sendFile(FRONTEND_INDEX_FILE);
  });
} else {
  if (ENABLE_STARTUP_WARNINGS) {
    console.warn(`[startup] Frontend build not found: ${FRONTEND_INDEX_FILE}`);
  }
}

const start = async () => {
  try {
    await clearTemporaryUploads();
    await sequelize.authenticate();
    if (ENABLE_DB_ALTER_SYNC) {
      await sequelize.sync({ alter: { drop: false } });
    } else {
      await sequelize.sync();
    }

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

    const server = app.listen(PORT);
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        console.error(`Server start error: port ${PORT} is already in use`);
      } else {
        console.error("Server start error:", error);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error("Database connection error:", error);
  }
};

start();
