const express = require("express");
const jwt = require("jsonwebtoken");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

const normalizePhone = (phone) => (phone ? String(phone).replace(/\D/g, "") : "");

const signAdminToken = ({ phone }) =>
  jwt.sign({ phone, role: "admin" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "24h",
  });

router.post("/admin-login", async (req, res) => {
  const { phone, password } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  const adminPhone = process.env.ADMIN_PHONE;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPhone || !adminPassword || !process.env.JWT_SECRET) {
    return res.status(503).json({ message: "Вход администратора не настроен" });
  }

  if (normalizedPhone !== normalizePhone(adminPhone)) {
    return res.status(403).json({ message: "Доступ запрещён" });
  }

  if (password !== adminPassword) {
    return res.status(401).json({ message: "Неверный пароль" });
  }

  const token = signAdminToken({ phone: normalizedPhone });
  return res.json({ token, phone: normalizedPhone, role: "admin" });
});

router.get("/admin-session", requireAdmin, (req, res) => {
  return res.json({ role: "admin" });
});

module.exports = router;
