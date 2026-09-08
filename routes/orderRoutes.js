const express = require("express");
const sequelize = require("../db");
const Order = require("../models/Order");
const requireAdmin = require("../middleware/requireAdmin");
const {
  orderCreateRateLimit,
  orderMutationRateLimit,
  orderReadRateLimit,
} = require("../middleware/rateLimit");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const {
  canAccessOrder,
  createOrderAccessToken,
  requireOrderAccess,
  requireOrderAccessConfigured,
} = require("../middleware/orderAccess");
const router = express.Router();

const fs = require("fs");
const path = require("path");
const OrderAttachment = require("../models/OrderAttachment");
const OrderShipment = require("../models/OrderShipment");
const { findInventoryForOrder } = require("../services/inventoryResolver");
const { finalizePaidOrder } = require("../services/orderFinalizer");
const { checkItemAndNotify } = require("../services/lowStockMonitor");
const {
  ReservationError,
  createOrderWithReservation,
  releaseReservationForOrder,
} = require("../services/inventoryReservations");
const {
  RequestValidationError,
  validateOrderCreateInput,
} = require("../lib/requestValidation");
const {
  PricingError,
  calculateCdekDelivery,
  calculateMerchandisePrice,
} = require("../services/orderPricing");
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

// ✅ Создание заказа
router.post(
  "/create",
  requireTrustedOrigin,
  requireOrderAccessConfigured,
  orderCreateRateLimit,
  (req, res, next) => req.is("multipart/form-data")
    ? next()
    : res.status(415).json({ message: "Content-Type должен быть multipart/form-data" }),
  orderImagesUpload,
  validateUploadedImages,
  cleanupTemporaryFilesAfterResponse,
  async (req, res) => {
  try {
    const validated = validateOrderCreateInput(req.body || {}, req.files || []);
    const {
      firstName,
      lastName,
      middleName,
      phone,
      recipientPhone,
      recipientFullName,
      productType,
      color,
      size,
      embroideryType,
      embroideryTypeRu,
      patronusCount,
      petFaceCount,
      customText,
      customTextFont,
      comment,
      email,
      preferredContact,
      deliveryComment,
      deliveryCity,
      deliveryAddress,
      cdekMode,
      cdekAddress,
    } = validated;

    // 5) Проверяем наличие на складе
    const inv = await findInventoryForOrder(productType, color, size);
    if (!inv) {
      console.error("[CREATE] inventory NOT FOUND for:", productType, color, size);
      return res.status(400).json({ message: "Комбинация товара на складе не найдена" });
    }
    const merchandiseQuote = calculateMerchandisePrice({
      inventory: inv,
      embroideryType,
      patronusCount,
      petFaceCount,
    });
    const isManualFlow = merchandiseQuote.manual || !cdekMode;
    const cdekQuote = isManualFlow
      ? null
      : await calculateCdekDelivery({
          inventory: inv,
          cdekMode,
          cdekAddress,
        });
    const totalPrice = isManualFlow
      ? null
      : merchandiseQuote.merchandisePrice + cdekQuote.deliveryPrice;
    const canonicalDeliveryAddress = cdekQuote
      ? [
          "СДЭК",
          cdekQuote.office.code,
          cdekQuote.office.location?.address,
          "до ПВЗ",
        ].filter(Boolean).join(", ")
      : deliveryAddress;

    // Создание заказа и резервирование единицы выполняются атомарно.
    const { order, reservation } = await createOrderWithReservation({
      inventoryId: inv.id,
      orderValues: {
        phone,
        firstName,
        lastName,
        middleName,
        productType: inv.productType,
        color: inv.color,
        size: inv.size,
        embroideryType,
        embroideryTypeRu,
        patronusCount,
        petFaceCount,
        customText,
        customTextFont: customTextFont || null,
        comment,
        recipientFullName,
        recipientPhone,
        email: email || null,
        preferredContact: preferredContact || null,
        deliveryComment: deliveryComment || null,
        deliveryCity: deliveryCity || null,
        deliveryMode: cdekQuote ? "cdek_pvz" : "manual",
        privacyConsentAt: new Date(),
        orderDate: new Date(),
        status: isManualFlow ? "Ожидает расчёта" : "Ожидание оплаты",
        paymentStatus: isManualFlow ? "manual" : "pending",
        paymentProvider: isManualFlow ? "manual" : null,
        totalPrice,
        deliveryAddress: canonicalDeliveryAddress,
      },
      shipmentValues: cdekQuote
        ? {
            provider: "cdek",
            tariffCode: cdekQuote.tariffCode,
            deliveryPoint: cdekQuote.office.code,
            recipientName: recipientFullName,
            recipientPhone,
            declaredValue: merchandiseQuote.merchandisePrice,
          }
        : null,
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
      try {
        await sequelize.transaction(async (transaction) => {
          const failedOrder = await Order.findByPk(order.id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          await releaseReservationForOrder(order.id, "attachment_failure", transaction);
          if (failedOrder) {
            failedOrder.status = "Ошибка сохранения вложений";
            failedOrder.paymentStatus = "cancelled";
            await failedOrder.save({ transaction });
          }
        });
      } catch (rollbackError) {
        console.error("Не удалось освободить резерв после ошибки вложений:", rollbackError);
      }
      throw e;
    }

    res.json({
      message: "Заказ успешно оформлен",
      orderId: order.id,
      orderToken: createOrderAccessToken(order.id),
      cdekNumber: null,
      pricePending: isManualFlow,
      merchandisePrice: merchandiseQuote.merchandisePrice,
      deliveryPrice: cdekQuote?.deliveryPrice ?? null,
      totalPrice,
      reservationExpiresAt: reservation.expiresAt,
    });
    checkItemAndNotify(inv.id).catch((error) => {
      console.error("Low-stock notify error after reservation:", error);
    });
  } catch (error) {
    if (
      error instanceof PricingError ||
      error instanceof ReservationError ||
      error instanceof RequestValidationError
    ) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        field: error.field || undefined,
      });
    }
    console.error("❌ Ошибка оформления заказа:", error);
    res.status(500).json({ message: "Ошибка оформления заказа" });
  }
  }
);
router.put("/update-status/:orderId", requireAdmin, orderMutationRateLimit, async (req, res) => {
    try {
        const orderId = Number(req.params.orderId);

        if (!Number.isInteger(orderId) || orderId < 1) {
            return res.status(400).json({ message: "Некорректный номер заказа" });
        }
        if (!req.is("application/json")) {
            return res.status(415).json({ message: "Content-Type должен быть application/json" });
        }
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({ message: "Некорректное тело запроса" });
        }
        if (Object.keys(req.body).some((key) => key !== "status")) {
            return res.status(400).json({ message: "Запрос содержит неизвестные поля" });
        }
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

        const updateResult = await sequelize.transaction(async (transaction) => {
            const lockedOrder = await Order.findByPk(orderId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!lockedOrder) return null;

            let releasedInventoryId = null;
            if (status === "Отменен") {
                const releasedInventory = await releaseReservationForOrder(
                    orderId,
                    "cancelled",
                    transaction
                );
                releasedInventoryId = releasedInventory?.id || null;
                if (lockedOrder.paymentStatus === "pending") {
                    lockedOrder.paymentStatus = "cancelled";
                }
            }
            lockedOrder.status = status;
            await lockedOrder.save({ transaction });
            return { order: lockedOrder, releasedInventoryId };
        });
        if (!updateResult) {
            return res.status(404).json({ message: "Заказ не найден" });
        }
        if (updateResult.releasedInventoryId) {
            checkItemAndNotify(updateResult.releasedInventoryId).catch((error) => {
                console.error("Low-stock notify error after cancellation:", error);
            });
        }

        res.json({ message: "Статус заказа обновлен", order: updateResult.order });
    } catch (error) {
        console.error("Ошибка обновления статуса:", error);
        res.status(500).json({ message: "Ошибка сервера при обновлении статуса" });
    }
});

// 🔍 Проверка статуса заказа по номеру
router.get("/status/:orderId", requireOrderAccess, orderReadRateLimit, async (req, res) => {
    try {
        const orderId = Number(req.params.orderId);
        if (!Number.isInteger(orderId) || orderId < 1) {
            return res.status(400).json({ message: "Некорректный номер заказа" });
        }
        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ message: "Заказ не найден" });
        }

        if (!canAccessOrder(req, order)) {
            return res.status(403).json({ message: "Нет доступа к заказу" });
        }

        const shipment = await OrderShipment.findOne({
            where: { orderId },
            attributes: ["status", "cdekNumber"],
            raw: true,
        });
        res.json({
            status: order.status,
            shipmentStatus: shipment?.status || null,
            cdekNumber: shipment?.cdekNumber || null,
        });
    } catch (error) {
        console.error("Ошибка получения статуса заказа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/all", requireAdmin, orderReadRateLimit, async (_req, res) => {
    try {
        const orders = await Order.findAll({ order: [["orderDate", "DESC"]] });
        const shipments = orders.length
            ? await OrderShipment.findAll({
                where: { orderId: orders.map((order) => order.id) },
                attributes: [
                    "orderId",
                    "provider",
                    "status",
                    "cdekNumber",
                    "attempts",
                    "lastError",
                ],
                raw: true,
            })
            : [];
        const shipmentByOrderId = new Map(
            shipments.map((shipment) => [Number(shipment.orderId), shipment])
        );
        res.json(orders.map((order) => ({
            ...order.get({ plain: true }),
            shipment: shipmentByOrderId.get(Number(order.id)) || null,
        })));
    } catch (error) {
        console.error("Ошибка при получении всех заказов:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// POST /api/orders/confirm/:orderId
router.post("/confirm/:orderId", requireOrderAccess, orderMutationRateLimit, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const { provider = "manual" } = req.body || {};
  const allowedProviders = new Set(["manual", "fallback"]);

  try {
    if (!Number.isInteger(orderId) || orderId < 1) {
      return res.status(400).json({ message: "Некорректный номер заказа" });
    }
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Content-Type должен быть application/json" });
    }
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== "provider")
    ) {
      return res.status(400).json({ message: "Некорректное тело запроса" });
    }
    if (!allowedProviders.has(provider)) {
      return res.status(403).json({ message: "Unsupported confirmation provider" });
    }

    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!canAccessOrder(req, order)) {
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
      eventId: `${provider}-${orderId}`,
    });

    if (!result.ok && result.message) {
      return res.status(409).json({ message: result.message });
    }
    return res.json({ ok: true, alreadyProcessed: !!result.alreadyProcessed });
  } catch (e) {
    return res.status(409).json({ message: e.message });
  }
});

router.get("/:orderId/attachments", requireOrderAccess, orderReadRateLimit, async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ message: "Некорректный номер заказа" });
  }

  try {
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: "Заказ не найден" });
    if (!canAccessOrder(req, order)) {
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

router.get("/:orderId/attachments/:attachmentId", requireOrderAccess, orderReadRateLimit, async (req, res, next) => {
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
    if (!canAccessOrder(req, order)) {
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
router.get('/:id', requireOrderAccess, orderReadRateLimit, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Bad id' });

  const order = await Order.findByPk(id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (!canAccessOrder(req, order)) return res.status(403).json({ message: 'Forbidden' });
  const shipment = await OrderShipment.findOne({
    where: { orderId: id },
    attributes: ["status", "cdekNumber"],
    raw: true,
  });

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
    shipmentStatus: shipment?.status || null,
    cdekNumber: shipment?.cdekNumber || null,
  });
});




router.use(uploadErrorHandler);

module.exports = router;
