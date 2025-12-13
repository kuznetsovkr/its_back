const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

// ✅ Получение данных авторизованного пользователя
router.get("/me", async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ message: "Нет доступа" });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        res.json({
            id: user.id,
            phone: user.phone,
            firstName: user.firstName || "",
            lastName: user.lastName || "",
            middleName: user.middleName || "",
            birthDate: user.birthDate || "",
            role: user.role || "user",
        });
    } catch (error) {
        console.error("❌ Ошибка при получении профиля:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// ✅ Обновление данных пользователя
router.put("/update", async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ message: "Нет доступа" });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { firstName, lastName, middleName, birthDate } = req.body;

        const user = await User.findByPk(decoded.id);
        if (!user) return res.status(404).json({ message: "Пользователь не найден" });

        // Обновляем данные
        user.firstName = firstName;
        user.lastName = lastName;
        user.middleName = middleName;
        user.birthDate = birthDate;
        await user.save();

        res.json({ message: "Данные обновлены", user });
    } catch (error) {
        res.status(500).json({ message: "Ошибка сервера при обновлении данных" });
    }
});

module.exports = router;
