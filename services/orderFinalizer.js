const sequelize = require("../db");
const Order = require("../models/Order");
const PaymentEvent = require("../models/PaymentEvent");
const OrderAttachment = require("../models/OrderAttachment");
const { isCdekAutoShipmentEnabled } = require("../config/cdekAutomation");
const { checkItemAndNotify } = require("./lowStockMonitor");
const { commitReservationForOrder } = require("./inventoryReservations");
const { GiftCertificateError } = require("../lib/giftCertificateRules");
const {
  createCdekShipmentForOrder,
  markCdekShipmentAwaitingFulfillment,
  markCdekShipmentReady,
} = require("./cdekShipments");
const sendOrderToTelegram = require("../telegram");

const finalizePaidOrder = async ({
  orderId,
  provider = "manual",
  eventId,
  overrides = {},
  paymentConfirmed = false,
  deferSideEffects = false,
}) => {
  const parsedOrderId = Number(orderId);
  if (!Number.isInteger(parsedOrderId) || parsedOrderId < 1) {
    throw new Error("orderId is required");
  }
  const normalizedEventId = String(eventId || `${provider}-${parsedOrderId}`).slice(0, 255);
  const autoCdekShipmentEnabled = isCdekAutoShipmentEnabled();
  const markPaidShipment = autoCdekShipmentEnabled
    ? markCdekShipmentReady
    : markCdekShipmentAwaitingFulfillment;

  const result = await sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(parsedOrderId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) return { ok: false, message: "Заказ не найден" };

    if (order.certificateId && order.paymentStatus === "review") {
      throw new GiftCertificateError("Оплата получена. Заказ требует ручной проверки сертификата", "paid_order_requires_review");
    }
    if (order.certificateId && provider === "paykeeper" && ["cancelled", "failed"].includes(order.paymentStatus)) {
      throw new GiftCertificateError("Оплата отменённого заказа требует ручной проверки", "paid_cancelled_certificate_order");
    }
    if (provider === "certificate") {
      if (!order.certificateId || order.amountDueKopecks !== 0 || Number(order.paymentAmount) !== 0
        || order.deliveryAmountKopecks !== 0 || order.certificateDiscountKopecks !== order.merchandiseAmountKopecks
        || order.paykeeperInvoiceId || !["pending", "paid"].includes(order.paymentStatus)
        || (order.paymentStatus === "paid" && order.paymentProvider !== "certificate")) {
        throw new GiftCertificateError("Этот заказ не покрыт сертификатом полностью", "certificate_order_not_covered", 409);
      }
    }

    const isManualFlow =
      provider === "manual" ||
      order.paymentProvider === "manual" ||
      order.paymentStatus === "manual";

    if (order.status === "Отменен" && !paymentConfirmed) {
      return { ok: false, message: "Заказ отменён" };
    }
    if (!paymentConfirmed && !isManualFlow && order.paymentStatus !== "paid") {
      return { ok: false, message: "Оплата ещё не подтверждена" };
    }

    const [, created] = await PaymentEvent.findOrCreate({
      where: { eventId: normalizedEventId },
      defaults: {
        provider,
        orderId: parsedOrderId,
        payload: overrides || {},
      },
      transaction,
    });
    const alreadyProcessed =
      !created || (!isManualFlow && order.status === "Оплачено");

    if (alreadyProcessed) {
      if (order.paymentStatus === "paid") {
        await markPaidShipment(order.id, transaction);
      }
      return { ok: true, alreadyProcessed: true, order, inventory: null };
    }

    if (paymentConfirmed) {
      if (provider === "certificate" && order.paymentStatus !== "paid") {
        const { assertActiveReservation } = require("./inventoryReservations");
        const { assertCertificateReservationForOrder } = require("./giftCertificates");
        await assertActiveReservation(order.id, transaction);
        await assertCertificateReservationForOrder({ order, transaction });
      }
      order.paymentStatus = "paid";
      order.paymentProvider = provider;
      order.paykeeperPaymentId = overrides.paymentId || order.paykeeperPaymentId;
      order.paidAt = order.paidAt || new Date();
    }

    const inventory = await commitReservationForOrder({ order, transaction });
    if (order.certificateId) {
      const { commitCertificateForOrder } = require("./giftCertificates");
      await commitCertificateForOrder({ orderId: order.id, paymentConfirmed: order.paymentStatus === "paid", transaction });
    }
    const overridePrice = Number(overrides.totalPrice);
    const hasNumericOverridePrice =
      overrides.totalPrice !== undefined && Number.isFinite(overridePrice) && overridePrice >= 0;

    if (isManualFlow) {
      order.status = "Ожидает расчёта";
      order.paymentStatus = order.paymentStatus === "paid" ? "paid" : "manual";
      order.paymentProvider = order.paymentProvider || provider;
    } else {
      order.status = "Оплачено";
      order.paidAt = order.paidAt || new Date();
      await markPaidShipment(order.id, transaction);
    }
    if (hasNumericOverridePrice) order.totalPrice = overridePrice;
    if (overrides.deliveryAddress) order.deliveryAddress = overrides.deliveryAddress;
    await order.save({ transaction });

    return { ok: true, alreadyProcessed: false, order, inventory };
  });

  if (!result.ok) return result;

  const runSideEffects = async () => {
    if (!result.alreadyProcessed) {
      try {
        await checkItemAndNotify(result.inventory.id);
      } catch (error) {
        console.error("Low-stock notify error:", error);
      }

      try {
        const files = await OrderAttachment.findAll({ where: { orderId: parsedOrderId }, raw: true });
        await sendOrderToTelegram(result.order.toJSON(), files);
      } catch (error) {
        console.error("Telegram send error:", error);
      }
    }

    if (autoCdekShipmentEnabled && result.order.paymentStatus === "paid") {
      try {
        result.shipment = await createCdekShipmentForOrder(parsedOrderId);
      } catch (error) {
        // Оплата и резерв уже подтверждены. Повтор выполнит фоновая задача.
        console.error(`[CDEK] Shipment creation failed for paid order ${parsedOrderId}:`, error.message);
      }
    }
  };

  if (deferSideEffects) {
    setImmediate(() => {
      runSideEffects().catch((error) => {
        console.error(`Paid-order side effects failed for order ${parsedOrderId}:`, error);
      });
    });
  } else {
    await runSideEffects();
  }

  return result;
};

module.exports = { finalizePaidOrder };
