const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const requireAdmin = require("../middleware/requireAdmin");
const {
  adminLoginIpRateLimit,
  adminLoginRateLimit,
  authSessionRateLimit,
} = require("../middleware/rateLimit");
const { assertAllowedKeys } = require("../lib/requestValidation");

const router = express.Router();

const normalizePhone = (phone) => (phone ? String(phone).replace(/\D/g, "") : "");

const signAdminToken = ({ phone }) =>
  jwt.sign({ phone, role: "admin" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "24h",
  });

const safeEqual = (left, right) => {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
};

router.post("/admin-login", adminLoginIpRateLimit, adminLoginRateLimit, async (req, res) => {
  const { phone, password } = req.body || {};
  if (!req.is("application/json")) {
    return res.status(415).json({ message: "Content-Type должен быть application/json" });
  }
  try {
    assertAllowedKeys(req.body || {}, new Set(["phone", "password"]), "авторизации");
  } catch (error) {
    return res.status(400).json({ message: error.message, field: error.field || undefined });
  }

  if (
    typeof phone !== "string" ||
    typeof password !== "string" ||
    phone.length > 32 ||
    password.length < 1 ||
    password.length > 256
  ) {
    return res.status(400).json({ message: "Некорректные данные авторизации" });
  }

  const normalizedPhone = normalizePhone(phone);
  const adminPhone = process.env.ADMIN_PHONE;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const jwtSecret = process.env.JWT_SECRET;
  const normalizedAdminPhone = normalizePhone(adminPhone);

  if (
    !adminPhone ||
    !adminPassword ||
    !jwtSecret ||
    !/^\d{10,11}$/.test(normalizedAdminPhone) ||
    Buffer.byteLength(adminPassword) < 12 ||
    Buffer.byteLength(jwtSecret) < 32
  ) {
    return res.status(503).json({ message: "Вход администратора не настроен" });
  }

  const phoneMatches = safeEqual(normalizedPhone, normalizedAdminPhone);
  const passwordMatches = safeEqual(password, adminPassword);
  if (
    !/^\d{10,11}$/.test(normalizedPhone) ||
    !phoneMatches ||
    !passwordMatches
  ) {
    return res.status(401).json({ message: "Неверные данные авторизации" });
  }

  const token = signAdminToken({ phone: normalizedPhone });
  return res.json({ token, phone: normalizedPhone, role: "admin" });
});

router.get("/admin-session", requireAdmin, authSessionRateLimit, (req, res) => {
  return res.json({ role: "admin" });
});

module.exports = router;
