const express = require("express");
const jwt = require("jsonwebtoken");
const requireAdmin = require("../middleware/requireAdmin");
require("dotenv").config();

const router = express.Router();

const smsChallenges = new Map(); // phone -> { code, expiresAt, attempts, requestedAt }

const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SMS_CODE_TTL_MS = Number(process.env.SMS_CODE_TTL_MS || 5 * 60 * 1000);
const SMS_REQUEST_COOLDOWN_MS = Number(process.env.SMS_REQUEST_COOLDOWN_MS || 60 * 1000);
const SMS_MAX_VERIFY_ATTEMPTS = Number(process.env.SMS_MAX_VERIFY_ATTEMPTS || 5);
const ENABLE_SMS_DEBUG_CODE =
  process.env.ENABLE_SMS_DEBUG_CODE === "1" && process.env.NODE_ENV !== "production";

const normalizePhone = (phone) => (phone ? String(phone).replace(/\D/g, "") : "");
const isRu11Phone = (phone) => /^\d{11}$/.test(phone) && phone.startsWith("7");

const signAuthToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "24h" });

router.post("/request-sms", async (req, res) => {
  if (!req.body || !req.body.phone) {
    return res.status(400).json({ message: "Неверный запрос: нужен phone" });
  }

  const normalizedPhone = normalizePhone(req.body.phone);
  if (!isRu11Phone(normalizedPhone)) {
    return res.status(400).json({ message: "Введите корректный номер телефона" });
  }

  const now = Date.now();
  const existing = smsChallenges.get(normalizedPhone);
  const resendInMs = existing ? existing.requestedAt + SMS_REQUEST_COOLDOWN_MS - now : 0;
  if (resendInMs > 0) {
    return res.status(429).json({
      message: `Повторная отправка через ${Math.ceil(resendInMs / 1000)} сек`,
    });
  }

  const smsCode = String(Math.floor(1000 + Math.random() * 9000));
  smsChallenges.set(normalizedPhone, {
    code: smsCode,
    expiresAt: now + SMS_CODE_TTL_MS,
    attempts: 0,
    requestedAt: now,
  });

  const response = { message: "Код отправлен" };
  if (ENABLE_SMS_DEBUG_CODE) {
    response.debugCode = smsCode;
  }
  return res.json(response);
});

router.post("/login", async (req, res) => {
  try {
    const { phone, smsCode } = req.body || {};
    if (!phone || !smsCode) {
      return res.status(400).json({ message: "Нужны phone и smsCode" });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!isRu11Phone(normalizedPhone)) {
      return res.status(400).json({ message: "Введите корректный номер телефона" });
    }

    const challenge = smsChallenges.get(normalizedPhone);
    if (!challenge) {
      return res.status(400).json({ message: "Код не запрошен" });
    }

    if (Date.now() > challenge.expiresAt) {
      smsChallenges.delete(normalizedPhone);
      return res.status(400).json({ message: "Срок действия кода истек" });
    }

    if (challenge.attempts >= SMS_MAX_VERIFY_ATTEMPTS) {
      smsChallenges.delete(normalizedPhone);
      return res.status(429).json({ message: "Превышено число попыток. Запросите новый код" });
    }

    if (String(challenge.code) !== String(smsCode)) {
      challenge.attempts += 1;
      if (challenge.attempts >= SMS_MAX_VERIFY_ATTEMPTS) {
        smsChallenges.delete(normalizedPhone);
        return res.status(429).json({ message: "Превышено число попыток. Запросите новый код" });
      }
      smsChallenges.set(normalizedPhone, challenge);
      return res.status(400).json({ message: "Неверный код" });
    }

    smsChallenges.delete(normalizedPhone);

    const role = "user";
    const token = signAuthToken({ phone: normalizedPhone, role });
    return res.json({ token, phone: normalizedPhone, role });
  } catch (error) {
    console.error("[AUTH] login error:", error);
    return res.status(500).json({ message: "Ошибка авторизации" });
  }
});

router.post("/admin-login", async (req, res) => {
  const { phone, password } = req.body || {};
  const normalizedPhone = normalizePhone(phone);

  if (!ADMIN_PHONE || !ADMIN_PASSWORD) {
    return res.status(503).json({ message: "Вход администратора не настроен" });
  }

  if (normalizedPhone !== normalizePhone(ADMIN_PHONE)) {
    return res.status(403).json({ message: "Доступ запрещен" });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Неверный пароль" });
  }

  const role = "admin";
  const token = signAuthToken({ phone: normalizedPhone, role });
  return res.json({ token, phone: normalizedPhone, role });
});

router.get("/admin-session", requireAdmin, (req, res) => {
  return res.json({ role: "admin" });
});

module.exports = router;
