const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

const router = express.Router();
const smsCodes = new Map(); // Временное хранилище кодов

const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

const normalizePhone = (phone) => {
    if (!phone) {
        console.error("🚨 Ошибка: normalizePhone получил undefined!");
        return "";
    }
    return phone.replace(/\D/g, "");
};

// Генерация кода и вывод в консоль (НО проверяем, если это не админ!)
router.post("/request-sms", async (req, res) => {
    console.log("📩 Получен запрос на /request-sms, тело запроса:", req.body);

    if (!req.body || !req.body.phone) {
        console.error("🚨 Ошибка: Номер телефона отсутствует в `req.body`!");
        return res.status(400).json({ message: "Введите номер телефона" });
    }

    const phone = req.body.phone;
    const normalizedPhone = normalizePhone(phone);
    console.log(`📞 Нормализованный номер: ${normalizedPhone}`);

    const normalizedAdminPhone = normalizePhone(ADMIN_PHONE || "");

    if (normalizedPhone === normalizedAdminPhone) {
        return res.json({ message: "Введите пароль" });
    }

    const smsCode = Math.floor(100000 + Math.random() * 900000);
    smsCodes.set(normalizedPhone, smsCode);

    console.log(`📞 СМС-код для ${normalizedPhone}: ${smsCode}`);

    return res.json({ message: "Код сгенерирован и выведен в консоль" });
});

//  Авторизация по SMS-коду
router.post("/login", async (req, res) => {
    try {
        const { phone, smsCode } = req.body;
        if (!phone || !smsCode) return res.status(400).json({ message: "Введите номер и код" });

        const normalizedPhone = normalizePhone(phone); // Приводим номер к стандартному виду
        console.log(`📞 Проверяем вход по SMS. Введённый номер: ${normalizedPhone}`);

        const validCode = smsCodes.get(normalizedPhone);
        console.log(`🔍 Найденный код в smsCodes: ${validCode}`);

        if (!validCode || validCode != smsCode) {
            return res.status(400).json({ message: "Неверный код" });
        }

        smsCodes.delete(normalizedPhone); // Удаляем использованный код

        //  Логируем перед запросом в базу
        console.log(`🔍 Проверяем пользователя с номером: ${normalizedPhone}`);

        let user = await User.findOne({ where: { phone: normalizedPhone } });

        if (!user) {
            console.log("👤 Пользователь не найден, создаём нового...");
            user = await User.create({ phone: normalizedPhone });
        }

        console.log(" Найден / создан пользователь:", user);

        // Генерируем JWT-токен
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "24h" });

        return res.json({ token, user });
    } catch (error) {
        console.error("❌ Ошибка при авторизации:", error);
        return res.status(500).json({ message: "Ошибка сервера при авторизации" });
    }
});


router.post("/admin-login", async (req, res) => {
    const { phone, password } = req.body;

    if (normalizePhone(phone) !== normalizePhone(ADMIN_PHONE)) {
        return res.status(403).json({ message: "Нет доступа" });
    }

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Неверный пароль" });
    }

    const token = jwt.sign({ phone, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "24h" });

    res.json({ token });
});

module.exports = router;
