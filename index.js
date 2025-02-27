require("dotenv").config();
const express = require("express");
const cors = require("cors");
const sequelize = require("./db");
const cdekRoutes = require("./routes/cdekRoutes");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const orderRoutes = require("./routes/orderRoutes");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cdek", cdekRoutes);
app.use("/api/user", userRoutes);

const start = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    console.log("✅ Database connected");

    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (error) {
    console.error("❌ Database connection error:", error);
  }
};

start();
