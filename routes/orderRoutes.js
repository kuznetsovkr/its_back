const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Order = require("../models/Order");
const sendOrderToTelegram = require("../telegram");
const router = express.Router();

// ✅ Создание заказа
router.post("/create", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        console.log("🔑 Заголовок Authorization:", authHeader);

        let user = null;
        if (authHeader) {
            try {
                const token = authHeader.split(" ")[1];
                user = jwt.verify(token, process.env.JWT_SECRET);
                console.log("👤 Пользователь авторизован:", user);
            } catch (error) {
                console.warn("⚠️ Ошибка при верификации токена:", error.message);
            }
        }

        let userData;
        if (user) {
            userData = await User.findByPk(user.id);
            console.log("✅ Данные авторизованного пользователя:", userData);
        } else {
            console.log("⚠️ Пользователь не авторизован, используем данные из запроса.");
            userData = {
                firstName: req.body.firstName || "Не указано",
                lastName: req.body.lastName || "Не указано",
                middleName: req.body.middleName || "",
                phone: req.body.phone || "Не указано",
            };
        }

        console.log("📦 Создание заказа с данными:", {
            ...userData,
            productType: req.body.productType,
            color: req.body.color,
            size: req.body.size,
            embroideryType: req.body.embroideryType,
            customText: req.body.customText,
            uploadedImage: req.body.uploadedImage,
            comment: req.body.comment,
        });

        // ✅ Создаём заказ в БД
        const order = await Order.create({
            userId: user?.id || null, // Если нет пользователя — null
            phone: userData.phone,
            firstName: userData.firstName,
            lastName: userData.lastName,
            middleName: userData.middleName,
            productType: req.body.productType,
            color: req.body.color,
            size: req.body.size,
            embroideryType: req.body.embroideryType,
            customText: req.body.customText,
            uploadedImage: req.body.uploadedImage,
            comment: req.body.comment,
            orderDate: new Date(),
        });

        console.log("✅ Заказ успешно сохранён в БД", order);

        // ✅ Отправляем заказ в Telegram
        await sendOrderToTelegram({
            orderDate: order.orderDate,
            phone: order.phone,
            fullName: `${order.lastName} ${order.firstName} ${order.middleName}`,
            productType: req.body.productType,
            color: req.body.color,
            size: req.body.size,
            embroideryType: req.body.embroideryType,
            customText: req.body.customText,
            uploadedImage: req.body.uploadedImage,
            comment: req.body.comment,
        });

        console.log("✅ Заказ успешно отправлен в Telegram");

        res.json({ message: "Заказ успешно оформлен", orderId: order.id });
    } catch (error) {
        console.error("❌ Ошибка оформления заказа:", error);
        res.status(500).json({ message: "Ошибка оформления заказа", error: error.message });
    }
});
router.put("/update-status/:orderId", async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;

        const validStatuses = ["pending", "processing", "shipped", "delivered", "canceled"];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: "Некорректный статус" });
        }

        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({ message: "Заказ не найден" });
        }

        order.status = status;
        await order.save();

        res.json({ message: "Статус заказа обновлен", order });
    } catch (error) {
        console.error("Ошибка обновления статуса:", error);
        res.status(500).json({ message: "Ошибка сервера при обновлении статуса" });
    }
});

// 🔍 Проверка статуса заказа по номеру
router.get("/status/:orderId", async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ message: "Заказ не найден" });
        }

        res.json({ status: order.status });
    } catch (error) {
        console.error("Ошибка получения статуса заказа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// 🔹 Получение заказов текущего пользователя
router.get("/user", async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ message: "Нет доступа" });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const orders = await Order.findAll({ where: { userId } });

        if (!orders.length) {
            return res.status(404).json({ message: "У вас пока нет заказов." });
        }

        res.json(orders);
    } catch (error) {
        console.error("❌ Ошибка при получении заказов:", error);
        res.status(500).json({ message: "Ошибка сервера при загрузке заказов." });
    }
});

module.exports = router;



module.exports = router;
