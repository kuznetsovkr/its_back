require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const sequelize = require("./db");
const cdekServiceRoutes = require("./routes/cdekServiceRoutes");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const clothingTypeRoutes = require("./routes/clothingTypeRoutes");
const pricingRoutes = require("./routes/pricingRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const fileRoutes = require("./routes/fileRoutes");
const colorsRouter = require("./routes/colors");
const { checkAllAndNotify, checkItemAndNotify } = require("./services/lowStockMonitor");
const { releaseExpiredReservations } = require("./services/inventoryReservations");
const { retryPendingCdekShipments } = require("./services/cdekShipments");
const { clearTemporaryUploads } = require("./lib/uploadSecurity");
const { createCorsMiddleware, handleCorsError } = require("./middleware/corsPolicy");
const {
  closeRateLimitStore,
  initializeRateLimitStore,
} = require("./services/rateLimitStore");
const { assertDatabaseMigrationsCurrent } = require("./services/databaseMigrations");
const { isClientAppRoute } = require("./config/clientRoutes");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  validateTelegramChannelConfig,
} = require("./services/telegramChannels");

require("./models/TelegramChannelSubscriber");
require("./models/OrderAttachment");
require("./models/InventoryReservation");
require("./models/OrderShipment");

const ENABLE_LOW_STOCK_CRON = process.env.ENABLE_LOW_STOCK_CRON === "1";
const ENABLE_RESERVATION_CRON = process.env.ENABLE_RESERVATION_CRON !== "0";
const ENABLE_CDEK_RETRY_CRON = process.env.ENABLE_CDEK_RETRY_CRON !== "0";
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

app.use(createCorsMiddleware());
app.use(handleCorsError);
app.use(express.json({ limit: "64kb", strict: true }));

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
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

  app.get(/.*/, (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path === "/api" ||
      req.path.startsWith("/payments/") ||
      req.path === "/service.php"
    ) {
      return next();
    }

    return res.status(isClientAppRoute(req.path) ? 200 : 404).sendFile(FRONTEND_INDEX_FILE);
  });
} else {
  if (ENABLE_STARTUP_WARNINGS) {
    console.warn(`[startup] Frontend build not found: ${FRONTEND_INDEX_FILE}`);
  }
}

const start = async () => {
  try {
    const rateLimitStore = await initializeRateLimitStore();
    console.log(`[startup] Rate-limit store: ${rateLimitStore.mode}`);
    await clearTemporaryUploads();
    await sequelize.authenticate();
    await assertDatabaseMigrationsCurrent(sequelize);

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

    if (ENABLE_RESERVATION_CRON) {
      let reservationCleanupRunning = false;
      const releaseReservations = async () => {
        if (reservationCleanupRunning) return;
        reservationCleanupRunning = true;
        try {
          const inventoryIds = await releaseExpiredReservations();
          await Promise.all([...new Set(inventoryIds)].map((id) => checkItemAndNotify(id)));
        } finally {
          reservationCleanupRunning = false;
        }
      };
      releaseReservations().catch((error) => {
        console.error("Initial reservation cleanup error:", error);
      });
      cron.schedule("* * * * *", async () => {
        try {
          await releaseReservations();
        } catch (error) {
          console.error("Reservation cleanup error:", error);
        }
      });
    }

    if (ENABLE_CDEK_RETRY_CRON) {
      let cdekRetryRunning = false;
      const retryCdekShipments = async () => {
        if (cdekRetryRunning) return;
        cdekRetryRunning = true;
        try {
          await retryPendingCdekShipments();
        } finally {
          cdekRetryRunning = false;
        }
      };
      retryCdekShipments().catch((error) => {
        console.error("Initial CDEK shipment retry error:", error);
      });
      cron.schedule("*/5 * * * *", async () => {
        try {
          await retryCdekShipments();
        } catch (error) {
          console.error("CDEK shipment retry error:", error);
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
    console.error("Server startup error:", error);
    await closeRateLimitStore();
    process.exitCode = 1;
  }
};

start();
