const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

const router = express.Router();
const smsCodes = new Map(); // phone -> code

const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const normalizePhone = (phone) => (phone ? phone.replace(/\D/g, "") : "");

const signUserToken = (payload) =>
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "24h" });

router.post("/request-sms", async (req, res) => {
    console.log("[AUTH] request-sms payload:", req.body);

    if (!req.body || !req.body.phone) {
        return res.status(400).json({ message: "Неверный запрос: нужен phone" });
    }

    const phone = req.body.phone;
    const normalizedPhone = normalizePhone(phone);
    const normalizedAdminPhone = normalizePhone(ADMIN_PHONE || "");

    if (normalizedPhone === normalizedAdminPhone) {
        return res.json({ message: "Для администратора используйте вход по паролю" });
    }

    const smsCode = Math.floor(1000 + Math.random() * 9000);
    smsCodes.set(normalizedPhone, smsCode);
    console.log(`[AUTH] generated sms code for ${normalizedPhone}: ${smsCode}`);

    return res.json({ message: "Код отправлен (dev)", debugCode: smsCode });
});

router.post("/login", async (req, res) => {
    try {
        const { phone, smsCode } = req.body || {};
        if (!phone || !smsCode) {
            return res.status(400).json({ message: "Нужны phone и smsCode" });
        }

        const normalizedPhone = normalizePhone(phone);
        console.log(`[AUTH] login attempt for ${normalizedPhone}`);

        const validCode = smsCodes.get(normalizedPhone);
        if (!validCode || validCode != smsCode) {
            return res.status(400).json({ message: "Неверный код" });
        }
        smsCodes.delete(normalizedPhone);

        let user = await User.findOne({ where: { phone: normalizedPhone } });
        if (!user) {
            console.log("[AUTH] user not found, creating...");
            user = await User.create({ phone: normalizedPhone, role: "user" });
        } else if (!user.role) {
            user.role = "user";
            await user.save();
        }

        const token = signUserToken({ id: user.id, role: user.role, phone: user.phone });

        return res.json({ token, user });
    } catch (error) {
        console.error("[AUTH] login error:", error);
        return res.status(500).json({ message: "Ошибка авторизации" });
    }
});

router.post("/admin-login", async (req, res) => {
    const { phone, password } = req.body || {};
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone !== normalizePhone(ADMIN_PHONE)) {
        return res.status(403).json({ message: "Доступ запрещён" });
    }

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Неверный пароль" });
    }

    let adminUser = await User.findOne({ where: { phone: normalizedPhone } });
    if (!adminUser) {
        adminUser = await User.create({ phone: normalizedPhone, role: "admin" });
    } else if (adminUser.role !== "admin") {
        adminUser.role = "admin";
        await adminUser.save();
    }

    const token = signUserToken({ id: adminUser.id, role: adminUser.role, phone: adminUser.phone });

    res.json({ token, user: adminUser });
});

module.exports = router;
