const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Order = require("../models/Order");
const sendOrderToTelegram = require("../telegram");
const sequelize = require("../db");
const Inventory = require("../models/Inventory");
const PaymentEvent = require("../models/PaymentEvent");
const router = express.Router();

const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { checkItemAndNotify } = require("../services/lowStockMonitor"); // путь подкорректируй, если нужен
const { findInventoryForOrder } = require("../services/inventoryResolver");


const upload = multer({ dest: "uploads/" }); // временно сохраняем файлы

// ✅ Создание заказа
router.post("/create", upload.array("images", 10), async (req, res) => {
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
            comment: req.body.comment,
        });

        const inv = await findInventoryForOrder(req.body.productType, req.body.color, req.body.size);

        if (!inv) {
        console.error("[CREATE] inventory NOT FOUND for:", req.body.productType, req.body.color, req.body.size);
        return res.status(400).json({ message: "Комбинация товара на складе не найдена" });
        }
        if (inv.quantity < 1) {
        console.error("[CREATE] not enough stock id=", inv.id, "qty=", inv.quantity);
        return res.status(409).json({ message: "Недостаточно товара на складе" });
        }

        // ✅ Создаём заказ в БД
            const order = await Order.create({
                userId: user?.id || null,
                phone: userData.phone,
                firstName: userData.firstName,
                lastName: userData.lastName,
                middleName: userData.middleName,
                productType: req.body.productType,
                color: req.body.color,
                size: req.body.size,
                embroideryType: req.body.embroideryType,
                customText: req.body.customText,
                comment: req.body.comment,
                orderDate: new Date(),
                status: "Ожидание оплаты",
                totalPrice: req.body.totalPrice ?? null,
                deliveryAddress: req.body.deliveryAddress ?? null,
                inventoryId: inv.id, // <-- ВАЖНО
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
            comment: req.body.comment,
            totalPrice: req.body.totalPrice, 
            deliveryAddress: req.body.deliveryAddress, 
            images: req.files, // массив файлов
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

        const validStatuses = ["Ожидание оплаты", "Оплачено", "Принят", "Дизайн", "Вышивка", "Отправлен", "Отменен"];
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

        const orders = await Order.findAll({ where: { userId }, order: [["orderDate", "DESC"]] });

        res.json(orders);
    } catch (error) {
        console.error("Ошибка при получении заказов:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/all", async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ message: "Нет доступа" });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Проверяем, является ли пользователь админом
        const user = await User.findByPk(decoded.id);
        if (!user || user.role !== "admin") {
            return res.status(403).json({ message: "Нет доступа" });
        }

        // Если админ, получаем все заказы
        const orders = await Order.findAll({ order: [["orderDate", "DESC"]] });

        res.json(orders);
    } catch (error) {
        console.error("Ошибка при получении всех заказов:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// POST /api/orders/confirm/:orderId
router.post("/confirm/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const { provider = "manual", eventId = `manual-${orderId}` } = req.body || {};

  const t = await sequelize.transaction();
  try {
    // 1) Idempotency
    await PaymentEvent.findOrCreate({
      where: { eventId },
      defaults: { provider, orderId, payload: req.body || {} },
      transaction: t,
    });

    // 2) Лочим заказ
    const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!order) {
      await t.rollback();
      return res.status(404).json({ message: "Заказ не найден" });
    }

    if (order.status === "Оплачено") {
      await t.commit();
      return res.json({ ok: true, alreadyProcessed: true });
    }

    // 3) Лочим строку склада и списываем 1 шт

    let item;

    if (order.inventoryId) {
    item = await Inventory.findByPk(order.inventoryId, { transaction: t, lock: t.LOCK.UPDATE });
    } else {
    // резерв для старых заказов без inventoryId
    const { findInventoryForOrder } = require("../services/inventoryResolver");
    item = await findInventoryForOrder(order.productType, order.color, order.size);
    if (item) {
        order.inventoryId = item.id;
        await order.save({ transaction: t });
    }
    }

    if (!item || item.quantity < 1) {
    throw new Error("Недостаточно товара на складе");
    }

    item.quantity = Math.max(0, item.quantity - 1);
    await item.save({ transaction: t });

    console.log("[CONFIRM]", { orderId, inventoryId: item.id, newQty: item.quantity });


    // 4) Обновляем заказ
    order.status = "Оплачено";
    order.paidAt = new Date();
    if (req.body.totalPrice) order.totalPrice = req.body.totalPrice;
    if (req.body.deliveryAddress) order.deliveryAddress = req.body.deliveryAddress;
    await order.save({ transaction: t });

    await t.commit();

    // ⬇️ После коммита — запускаем проверку остатка (не ломаем ответ, если телега упадёт)
    try {
      await checkItemAndNotify(item.id);
    } catch (notifyErr) {
      console.error("Low-stock notify error:", notifyErr);
    }

    res.json({ ok: true });
  } catch (e) {
    await t.rollback();
    console.error("❌ Ошибка confirm:", e);
    res.status(409).json({ message: e.message });
  }
});

router.get('/orders/:id', async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json({
    id: order.id,
    paymentStatus: order.paymentStatus,
    status: order.status,
    paidAt: order.paidAt,
  });
});



module.exports = router;
