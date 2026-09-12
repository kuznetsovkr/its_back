const express = require("express");
const crypto = require("crypto");
const sequelize = require("../db");
const { createInvoice } = require("../lib/paykeeper");
const Order = require("../models/Order");
const { finalizePaidOrder } = require("../services/orderFinalizer");
const { sendOrderIssueToTelegram } = require("../telegram");
const {
  ReservationError,
  assertActiveReservation,
} = require("../services/inventoryReservations");
const { canAccessOrder, requireOrderAccess } = require("../middleware/orderAccess");
const {
  paymentCallbackRateLimit,
  paymentLinkRateLimit,
} = require("../middleware/rateLimit");

const router = express.Router();
const callbackFormParser = express.urlencoded({
  extended: false,
  limit: "16kb",
  parameterLimit: 12,
});

const formatMoney = (value) => Number(value).toFixed(2);
const makePayUrl = (invoiceId) =>
  `${String(process.env.PAYKEEPER_BASE_URL || "").replace(/\/$/, "")}/bill/${encodeURIComponent(invoiceId)}/`;

const safeHexEqual = (received, expected) => {
  if (!/^[a-f0-9]{32}$/i.test(String(received || ""))) return false;
  const receivedBuffer = Buffer.from(String(received), "hex");
  const expectedBuffer = Buffer.from(String(expected), "hex");
  return receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
};

router.post("/link", requireOrderAccess, paymentLinkRateLimit, async (req, res) => {
  try {
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Content-Type должен быть application/json" });
    }
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "orderId")
    ) {
      return res.status(400).json({ message: "Некорректное тело запроса" });
    }
    const orderId = Number(body.orderId);
    if (!Number.isInteger(orderId) || orderId < 1) {
      return res.status(400).json({ message: "Некорректный номер заказа" });
    }

    const payment = await sequelize.transaction(async (transaction) => {
      const order = await Order.findByPk(orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!order) return { status: 404, message: "Order not found" };
      if (!canAccessOrder(req, order)) return { status: 403, message: "Forbidden" };
      if (order.paymentStatus === "paid") {
        return { status: 409, message: "Order already paid" };
      }
      if (order.paymentProvider === "manual" || order.paymentStatus === "manual") {
        return { status: 409, message: "Оплата для этого заказа не требуется" };
      }

      await assertActiveReservation(order.id, transaction);
      const orderAmount = Number(order.totalPrice);
      if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
        return { status: 409, message: "Некорректная сумма заказа для оплаты" };
      }

      if (order.paykeeperInvoiceId) {
        return {
          invoice_id: order.paykeeperInvoiceId,
          pay_url: makePayUrl(order.paykeeperInvoiceId),
        };
      }

      const invoice = await createInvoice({
        pay_amount: formatMoney(orderAmount),
        clientid: [order.lastName, order.firstName, order.middleName]
          .filter(Boolean)
          .join(" ") || "Покупатель",
        orderid: String(order.id),
        client_email: "",
        client_phone: order.phone || "",
        service_name: `Оплата заказа #${order.id}`,
      });

      await order.update({
        paymentProvider: "paykeeper",
        paymentStatus: "pending",
        paykeeperInvoiceId: invoice.invoice_id,
      }, { transaction });
      return invoice;
    });

    if (payment.status) {
      return res.status(payment.status).json({ message: payment.message });
    }
    return res.json(payment);
  } catch (error) {
    if (error instanceof ReservationError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error("[PayKeeper] Payment-link creation failed:", error.message);
    return res.status(502).json({ message: "Не удалось создать ссылку на оплату" });
  }
});

router.post(
  "/callback",
  paymentCallbackRateLimit,
  callbackFormParser,
  async (req, res) => {
    try {
      if (!req.is("application/x-www-form-urlencoded")) {
        return res.status(415).send("Error! Unsupported content type");
      }

      const { id, sum, clientid = "", orderid = "", key } = req.body || {};
      const paymentId = String(id || "");
      const amount = String(sum || "");
      const customerId = String(clientid || "");
      const rawOrderId = String(orderid || "");
      const secret = String(process.env.PAYKEEPER_SECRET_SEED || "");

      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(paymentId) ||
        !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) ||
        customerId.length > 200 ||
        !/^\d{1,10}$/.test(rawOrderId) ||
        secret.length < 16
      ) {
        return res.status(400).send("Error! Invalid callback data");
      }

      const parsedOrderId = Number(rawOrderId);
      if (!Number.isSafeInteger(parsedOrderId) || parsedOrderId < 1) {
        return res.status(400).send("Error! Bad orderid");
      }

      const expectedSignature = crypto
        .createHash("md5")
        .update(paymentId + formatMoney(amount) + customerId + rawOrderId + secret)
        .digest("hex");
      if (!safeHexEqual(key, expectedSignature)) {
        console.warn("PayKeeper webhook: bad signature", { orderid: rawOrderId, id: paymentId });
        return res.status(400).send("Error! Hash mismatch");
      }

      const order = await Order.findByPk(parsedOrderId);
      if (!order) return res.status(404).send("Order not found");

      const expectedOrderAmount = Number(order.totalPrice);
      const receivedAmount = Number(amount);
      if (
        !Number.isFinite(expectedOrderAmount) ||
        !Number.isFinite(receivedAmount) ||
        Math.round(receivedAmount * 100) !== Math.round(expectedOrderAmount * 100)
      ) {
        console.warn("PayKeeper webhook: sum mismatch", {
          orderid: rawOrderId,
          sum: amount,
        });
        return res.status(400).send("Error! Sum mismatch");
      }

      try {
        const finalized = await finalizePaidOrder({
          orderId: order.id,
          provider: "paykeeper",
          eventId: `pk-${paymentId}`,
          paymentConfirmed: true,
          overrides: { paymentId },
        });
        if (!finalized.ok) {
          throw new Error(finalized.message || "Order finalization failed");
        }
      } catch (error) {
        if (error instanceof ReservationError && error.code === "paid_order_out_of_stock") {
          const shouldNotify = order.status !== "Оплачен — требуется проверка остатка";
          await order.update({
            paymentStatus: "paid",
            paymentProvider: "paykeeper",
            paykeeperPaymentId: paymentId,
            paidAt: order.paidAt || new Date(),
            status: "Оплачен — требуется проверка остатка",
          });
          console.error(`[PayKeeper] Paid order ${order.id} could not reacquire expired stock`);
          if (shouldNotify) {
            try {
              await sendOrderIssueToTelegram(
                order.toJSON(),
                "Оплата получена после истечения резерва, но товара уже нет в наличии"
              );
            } catch (notificationError) {
              console.error("Paid-order issue notification failed:", notificationError.message);
            }
          }
        } else {
          throw error;
        }
      }

      const responseHash = crypto
        .createHash("md5")
        .update(paymentId + secret)
        .digest("hex");
      return res.send(`OK ${responseHash}`);
    } catch (error) {
      console.error("PayKeeper callback error:", error.message);
      return res.status(500).send("Error");
    }
  }
);

module.exports = router;
