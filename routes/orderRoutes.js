const express = require("express");
const Order = require("../models/Order");
const axios = require("axios");
const requireAdmin = require("../middleware/requireAdmin");
const authMiddleware = require("../middleware/authMiddleware");
const { orderCreateRateLimit } = require("../middleware/rateLimit");
const router = express.Router();

const fs = require("fs");
const path = require("path");
const OrderAttachment = require("../models/OrderAttachment");
const { findInventoryForOrder } = require("../services/inventoryResolver");
const { finalizePaidOrder } = require("../services/orderFinalizer");
const {
  ORDER_UPLOAD_DIR,
  cleanupTemporaryFilesAfterResponse,
  inspectStoredImage,
  isPathInside,
  orderImagesUpload,
  persistValidatedImage,
  sanitizeOriginalName,
  streamImage,
  uploadErrorHandler,
  validateUploadedImages,
} = require("../lib/uploadSecurity");

const CDEK_SERVICE_TOKEN = process.env.CDEK_SERVICE_TOKEN || process.env.JWT_SECRET || "";

const normalizePhoneDigits = (value) => String(value || "").replace(/\D/g, "");
const canAccessOrder = (user, order) => {
  if (user?.role === "admin") return true;
  const userPhone = normalizePhoneDigits(user?.phone);
  return userPhone !== "" && userPhone === normalizePhoneDigits(order?.phone);
};

// ✅ Создание заказа
router.post(
  "/create",
  authMiddleware,
  orderCreateRateLimit,
  orderImagesUpload,
  validateUploadedImages,
  cleanupTemporaryFilesAfterResponse,
  async (req, res) => {
  try {
    // Поля формы (multer кладёт строки в req.body)
    const body = req.body || {};
    const safe = (v) => (v == null ? "" : String(v));
    const toNumberOrNull = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const firstName        = safe(body.firstName);
    const lastName         = safe(body.lastName);
    const middleName       = safe(body.middleName);
    const phone            = safe(body.phone);
    const productType      = safe(body.productType);
    const color            = safe(body.color);
    const size             = safe(body.size);
    const embroideryType   = safe(body.embroideryType);
    let embroideryTypeRu   = safe(body.embroideryTypeRu);
    const patronusCount    = toNumberOrNull(body.patronusCount);
    const petFaceCount     = toNumberOrNull(body.petFaceCount);
    const customText       = safe(body.customText);
    const customOptionRaw  = body.customOption;
    const parseJson = (val) => {
      if (!val) return null;
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch (_) {
          return null;
        }
      }
      if (typeof val === "object") return val;
      return null;
    };
    const customOption     = parseJson(customOptionRaw) || {};
    const comment          = safe(body.comment);
    const deliveryAddressRaw = safe(body.deliveryAddress);
    const cdekMode         = safe(body.cdekMode);
    const parsedCdekAddr   = parseJson(body.cdekAddress) || {};
    const cdekPvzCode      = safe(parsedCdekAddr.code || body.cdekPvzCode || body.cdekCode || parsedCdekAddr.office_code);

    const rawTotalPrice    = body.totalPrice;
    const parsedTotalPrice = Number(rawTotalPrice);
    const hasNumericPrice  = Number.isFinite(parsedTotalPrice);
    const totalPrice       = hasNumericPrice ? parsedTotalPrice : null;
    const isCustomEmbroidery = ["custom", "other", "другая", "другое"].includes(
      (embroideryType || "").trim().toLowerCase()
    );
    const isManualFlow = isCustomEmbroidery || !hasNumericPrice;

    if (!canAccessOrder(req.user, { phone })) {
      return res.status(403).json({ message: "Нельзя оформить заказ на другой номер телефона" });
    }

    if ((embroideryType || "").trim().toLowerCase() === "petface" && (req.files || []).length > 5) {
      return res.status(400).json({ message: "Для портрета питомца можно загрузить не более 5 изображений" });
    }

    // Оформление адреса с пометкой СДЭК + режим
    const modeLabel = cdekMode === "door" ? "до двери" : cdekMode === "office" ? "до ПВЗ" : "";
    const deliveryAddressForStore = cdekMode
      ? ["СДЭК", cdekPvzCode, deliveryAddressRaw, modeLabel].filter(Boolean).join(", ")
      : deliveryAddressRaw;

    // Читаем уточнение по кастомной вышивке
    if (isCustomEmbroidery && !embroideryTypeRu) {
      const isCustomText  = !!customOption.text;
      const isCustomImage = !!customOption.image;
      if (isCustomText && !isCustomImage) {
        embroideryTypeRu = "Своя вышивка — надпись";
      } else if (isCustomImage && !isCustomText) {
        embroideryTypeRu = "Своя вышивка — изображение";
      } else {
        embroideryTypeRu = "Своя вышивка";
      }
    }

    // 4) Мини-валидация, чтобы не ловить notNull на модели
    if (!firstName || !lastName) {
      return res.status(400).json({ message: "Введите фамилию и имя" });
    }

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
      phone,
      firstName,
      lastName,
      middleName,
      productType,
      color,
      size,
      embroideryType,
      embroideryTypeRu,
      patronusCount,
      petFaceCount,
      customText,
      comment,
      orderDate: new Date(),
      status: isManualFlow ? "Ожидает расчёта" : "Ожидание оплаты",
      paymentStatus: isManualFlow ? "manual" : "pending",
      paymentProvider: isManualFlow ? "manual" : null,
      totalPrice,
      deliveryAddress: deliveryAddressForStore,
      inventoryId: inv.id,
    });

    // 📎 Сохранить прикреплённые файлы как вложения заказа
    const persistedPaths = [];
    try {
      const orderDir = path.join(ORDER_UPLOAD_DIR, String(order.id));
      const attachments = [];

      for (const file of (req.files || [])) {
        const stored = await persistValidatedImage(file, orderDir);
        persistedPaths.push(stored.path);
        attachments.push({
          orderId: order.id,
          path: stored.path,
          mime: stored.mime,
          originalName: sanitizeOriginalName(file.originalname, stored.fileName),
          size: file.size,
        });
      }

      if (attachments.length) {
        await OrderAttachment.bulkCreate(attachments);
      }
    } catch (e) {
      await Promise.all(
        persistedPaths.map((filePath) =>
          fs.promises.unlink(filePath).catch((error) => {
            if (error.code !== "ENOENT") {
              console.warn(`[uploads] Failed to remove incomplete attachment: ${error.message}`);
            }
          })
        )
      );
      console.error("⚠️ Не удалось сохранить вложения заказа:", e);
      // Не роняем оформление — вложения опциональны.
    }

    let cdekResult = null;
    if (cdekMode) {
      try {
        cdekResult = await sendOrderToCdek({
          order,
          body: req.body,
          totalPrice: totalPrice ?? 0,
          deliveryAddress: deliveryAddressRaw,
          phone,
          nameParts: { firstName, lastName, middleName },
        });
      } catch (e) {
        console.error("[CREATE] CDEK create_order failed:", e?.response?.data || e.message || e);
      }
    }


    res.json({
      message: "Заказ успешно оформлен",
      orderId: order.id,
      cdekNumber: cdekResult?.cdekNumber || null,
    });
  } catch (error) {
    console.error("❌ Ошибка оформления заказа:", error);
    res.status(500).json({ message: "Ошибка оформления заказа", error: error.message });
  }
  }
);
router.put("/update-status/:orderId", requireAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;

        const validStatuses = [
            "Ожидает расчёта",
            "Ожидание оплаты",
            "Оплачено",
            "Принят",
            "Дизайн",
            "Вышивка",
            "Отправлен",
            "Отменен"
        ];
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

router.get("/all", requireAdmin, async (_req, res) => {
    try {
        const orders = await Order.findAll({ order: [["orderDate", "DESC"]] });
        res.json(orders);
    } catch (error) {
        console.error("Ошибка при получении всех заказов:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// POST /api/orders/confirm/:orderId
router.post("/confirm/:orderId", authMiddleware, async (req, res) => {
  const { orderId } = req.params;
  const { provider = "manual", eventId, totalPrice, deliveryAddress } = req.body || {};
  const allowedProviders = new Set(["manual", "fallback"]);

  try {
    if (!allowedProviders.has(provider)) {
      return res.status(403).json({ message: "Unsupported confirmation provider" });
    }

    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const user = req.user || {};
    const isAdmin = user.role === "admin";
    const isOwnerByPhone =
      normalizePhoneDigits(order.phone) !== "" &&
      normalizePhoneDigits(order.phone) === normalizePhoneDigits(user.phone);

    if (!isAdmin && !isOwnerByPhone) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (
      provider === "manual" &&
      order.paymentProvider !== "manual" &&
      order.paymentStatus !== "manual"
    ) {
      return res.status(409).json({ message: "Manual confirm is not allowed for this order" });
    }

    if (provider === "fallback" && order.paymentStatus !== "paid") {
      return res.status(409).json({ message: "Payment is not confirmed yet" });
    }

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

router.get("/:orderId/attachments", authMiddleware, async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ message: "Некорректный номер заказа" });
  }

  try {
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Заказ не найден" });
    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ message: "Нет доступа к вложениям заказа" });
    }

    const attachments = await OrderAttachment.findAll({
      where: { orderId },
      attributes: ["id", "originalName", "mime", "size"],
      order: [["id", "ASC"]],
    });

    return res.json(
      attachments.map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mime: attachment.mime,
        size: attachment.size,
        downloadUrl: `/api/orders/${orderId}/attachments/${attachment.id}`,
      }))
    );
  } catch (error) {
    console.error("[uploads] Failed to list order attachments:", error);
    return res.status(500).json({ message: "Не удалось получить вложения заказа" });
  }
});

router.get("/:orderId/attachments/:attachmentId", authMiddleware, async (req, res, next) => {
  const orderId = Number(req.params.orderId);
  const attachmentId = Number(req.params.attachmentId);
  if (
    !Number.isInteger(orderId) ||
    orderId < 1 ||
    !Number.isInteger(attachmentId) ||
    attachmentId < 1
  ) {
    return res.status(400).json({ message: "Некорректный номер вложения" });
  }

  try {
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Заказ не найден" });
    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ message: "Нет доступа к вложениям заказа" });
    }

    const attachment = await OrderAttachment.findOne({
      where: { id: attachmentId, orderId },
    });
    if (!attachment) {
      return res.status(404).json({ message: "Вложение не найдено" });
    }

    const filePath = path.resolve(String(attachment.path || ""));
    if (!isPathInside(ORDER_UPLOAD_DIR, filePath)) {
      return res.status(404).json({ message: "Вложение не найдено" });
    }

    const info = await inspectStoredImage(filePath);
    return streamImage({
      res,
      next,
      filePath,
      info,
      downloadName: attachment.originalName || `attachment-${attachment.id}${info.extension}`,
    });
  } catch (error) {
    if (["ENOENT", "INVALID_STORED_IMAGE"].includes(error.code)) {
      return res.status(404).json({ message: "Вложение не найдено" });
    }
    return next(error);
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
    paymentProvider: order.paymentProvider || null,
    status: order.status,                        // бизнес-статус
    paidAt: order.paidAt,
    totalPrice: order.totalPrice,
    pricePending: order.paymentStatus === "manual" || order.paymentProvider === "manual" || order.totalPrice == null,
    paykeeperInvoiceId: order.paykeeperInvoiceId,
    paykeeperPaymentId: order.paykeeperPaymentId,
  });
});




async function sendOrderToCdek({ order, body, totalPrice, deliveryAddress, phone, nameParts }) {
  const serviceUrl =
    process.env.CDEK_SERVICE_URL ||
    (process.env.PUBLIC_APP_URL ? `${process.env.PUBLIC_APP_URL}/service.php` : "http://localhost:5000/service.php");

  if (!serviceUrl) {
    console.warn("[CDEK] CDEK_SERVICE_URL/PUBLIC_APP_URL not configured, skipping create_order");
    return;
  }

  const parseMaybeJson = (val) => {
    if (!val) return null;
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return val;
  };

  const cdekTariff = parseMaybeJson(body.cdekTariff) || body.cdekTariff;
  const cdekAddress = parseMaybeJson(body.cdekAddress) || body.cdekAddress;
  const cdekGoods = parseMaybeJson(body.cdekGoods) || body.cdekGoods;
  const cdekFrom = parseMaybeJson(body.cdekFrom) || body.cdekFrom;
  const deliveryPayment = parseMaybeJson(body.deliveryPayment) || body.deliveryPayment;

  const payload = {
    action: "create_order", // дублируем в body на случай, если query потеряется
    number: order.id,
    cdekMode: body.cdekMode,
    cdekTariffCode: body.cdekTariffCode,
    cdekTariff,
    cdekAddress,
    cdekAddressLabel: body.cdekAddressLabel,
    cdekGoods,
    cdekFrom,
    recipientFullName:
      body.recipientFullName ||
      [nameParts.lastName, nameParts.firstName, nameParts.middleName].filter(Boolean).join(" "),
    recipientPhoneDigits: body.recipientPhoneDigits || phone,
    totalPrice,
    deliveryPayment,
    deliveryAddress,
    comment: body.comment,
  };

  if (!payload.cdekTariffCode && payload.cdekTariff && payload.cdekTariff.tariff_code) {
    payload.cdekTariffCode = payload.cdekTariff.tariff_code;
  }

  try {
    const resp = await axios.post(`${serviceUrl}?action=create_order`, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-CDEK-Service-Token": CDEK_SERVICE_TOKEN,
      },
      timeout: 10000,
    });
    const data = resp?.data || {};
    const entity = data?.entity || {};
    const cdekNumber = entity?.cdek_number || entity?.cdekNumber || null;
    return { cdekNumber, data };
  } catch (e) {
    const resp = e.response;
    console.error("[CDEK] create_order error", {
      status: resp?.status,
      data: resp?.data,
      url: resp?.config?.url,
    });
    throw e;
  }
}

router.use(uploadErrorHandler);

module.exports = router;
