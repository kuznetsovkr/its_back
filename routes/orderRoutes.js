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
const { finalizePaidOrder } = require("../services/orderFinalizer");


const upload = multer({ dest: "uploads/" }); // временно сохраняем файлы

// ✅ Создание заказа
router.post("/create", upload.array("images", 10), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("🔑 Заголовок Authorization:", authHeader);

    // 1) Авторизация (как было)
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

    // 2) Забираем профиль (если есть)
    let profile = null;
    if (user) {
      profile = await User.findByPk(user.id, { raw: true });
      console.log("✅ Данные авторизованного пользователя:", profile);
    } else {
      console.log("⚠️ Пользователь не авторизован, используем данные из запроса.");
    }

    // 3) Поля формы (multer кладёт строки в req.body)
    const body = req.body || {};
    const safe = (v) => (v == null ? "" : String(v));

    // ⬇️ Приоритет: formData → профиль → пусто
    const firstName       = safe(body.firstName)   || safe(profile?.firstName);
    const lastName        = safe(body.lastName)    || safe(profile?.lastName);
    const middleName      = safe(body.middleName)  || safe(profile?.middleName);
    const phone           = safe(body.phone)       || safe(profile?.phone);
    const productType     = safe(body.productType);
    const color           = safe(body.color);
    const size            = safe(body.size);
    const embroideryType  = safe(body.embroideryType);
    const customText      = safe(body.customText);
    const comment         = safe(body.comment);
    const deliveryAddress = safe(body.deliveryAddress);
    const totalPrice      = Number(body.totalPrice) || 0;

    // 4) Мини-валидация, чтобы не ловить notNull на модели
    if (!firstName || !lastName) {
      return res.status(400).json({ message: "Введите фамилию и имя" });
    }

    console.log("📦 Создание заказа с данными:", {
      id: user?.id || null,
      firstName, lastName, middleName, phone,
      productType, color, size, embroideryType, customText, comment,
    });

    // 5) Проверяем наличие на складе
    const inv = await findInventoryForOrder(productType, color, size);
    if (!inv) {
      console.error("[CREATE] inventory NOT FOUND for:", productType, color, size);
      return res.status(400).json({ message: "Комбинация товара на складе не найдена" });
    }
    if (inv.quantity < 1) {
      console.error("[CREATE] not enough stock id=", inv.id, "qty=", inv.quantity);
      return res.status(409).json({ message: "Недостаточно товара на складе" });
    }

    // 6) Создаём заказ
    const order = await Order.create({
      userId: user?.id || null,
      phone,
      firstName,
      lastName,
      middleName,
      productType,
      color,
      size,
      embroideryType,
      customText,
      comment,
      orderDate: new Date(),
      status: "Ожидание оплаты",
      paymentStatus: "pending",
      totalPrice,
      deliveryAddress,
      inventoryId: inv.id,
    });

    console.log("✅ Заказ успешно сохранён в БД", order.id);
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
  const { provider = "manual", eventId, totalPrice, deliveryAddress } = req.body || {};

  try {
    const result = await finalizePaidOrder({
      orderId,
      provider,
      eventId: eventId || `${provider}-${orderId}`,
      overrides: { totalPrice, deliveryAddress },
    });

    if (!result.ok && result.message) {
      return res.status(409).json({ message: result.message });
    }
    return res.json({ ok: true, alreadyProcessed: !!result.alreadyProcessed });
  } catch (e) {
    return res.status(409).json({ message: e.message });
  }
});

// 👉 ДОЛЖЕН быть в самом конце файла, перед module.exports
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Bad id' });

  const order = await Order.findByPk(id);
  if (!order) return res.status(404).json({ message: 'Order not found' });

  // Отдаём только то, что нужно фронту
  res.json({
    id: order.id,
    paymentStatus: order.paymentStatus || null, // 'pending' | 'paid' | 'failed'
    status: order.status,                        // бизнес-статус
    paidAt: order.paidAt,
    totalPrice: order.totalPrice,
    paykeeperInvoiceId: order.paykeeperInvoiceId,
    paykeeperPaymentId: order.paykeeperPaymentId,
  });
});




module.exports = router;
