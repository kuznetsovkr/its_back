const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

const router = express.Router();
const smsCodes = new Map(); // Временное хранилище кодов

// ✅ Генерация кода и вывод в консоль (вместо SMS.RU)
router.post("/request-sms", async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Введите номер телефона" });

    const smsCode = Math.floor(100000 + Math.random() * 900000); // Генерация 6-значного кода
    smsCodes.set(phone, smsCode);

    console.log(`📞 СМС-код для ${phone}: ${smsCode}`); // Выводим в консоль

    return res.json({ message: "Код сгенерирован и выведен в консоль" });
});

// ✅ Авторизация по SMS-коду
router.post("/login", async (req, res) => {
    try {
        const { phone, smsCode } = req.body;
        if (!phone || !smsCode) return res.status(400).json({ message: "Введите номер и код" });

        const validCode = smsCodes.get(phone);
        if (!validCode || validCode != smsCode) {
            return res.status(400).json({ message: "Неверный код" });
        }

        smsCodes.delete(phone); // Удаляем использованный код

        // 🔍 Логируем перед запросом в базу
        console.log(`🔍 Проверяем пользователя с номером: ${phone}`);

        let user = await User.findOne({ where: { phone } });

        if (!user) {
            console.log("👤 Пользователь не найден, создаём нового...");
            user = await User.create({ phone });
        }

        console.log("✅ Найден / создан пользователь:", user);

        // Генерируем JWT-токен
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "24h" });

        return res.json({ token, user });
    } catch (error) {
        console.error("❌ Ошибка при авторизации:", error);
        return res.status(500).json({ message: "Ошибка сервера при авторизации" });
    }
});

module.exports = router;
