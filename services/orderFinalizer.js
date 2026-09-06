const sequelize = require("../db");
const Order = require("../models/Order");
const PaymentEvent = require("../models/PaymentEvent");
const OrderAttachment = require("../models/OrderAttachment");
const { checkItemAndNotify } = require("./lowStockMonitor");
const { commitReservationForOrder } = require("./inventoryReservations");
const {
  createCdekShipmentForOrder,
  markCdekShipmentReady,
} = require("./cdekShipments");
const sendOrderToTelegram = require("../telegram");

const finalizePaidOrder = async ({
  orderId,
  provider = "manual",
  eventId,
  overrides = {},
  paymentConfirmed = false,
}) => {
  const parsedOrderId = Number(orderId);
  if (!Number.isInteger(parsedOrderId) || parsedOrderId < 1) {
    throw new Error("orderId is required");
  }
  const normalizedEventId = String(eventId || `${provider}-${parsedOrderId}`).slice(0, 255);

  const result = await sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(parsedOrderId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) return { ok: false, message: "Заказ не найден" };

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
        await markCdekShipmentReady(order.id, transaction);
      }
      return { ok: true, alreadyProcessed: true, order, inventory: null };
    }

    if (paymentConfirmed) {
      order.paymentStatus = "paid";
      order.paymentProvider = provider;
      order.paykeeperPaymentId = overrides.paymentId || order.paykeeperPaymentId;
      order.paidAt = order.paidAt || new Date();
    }

    const inventory = await commitReservationForOrder({ order, transaction });
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
      await markCdekShipmentReady(order.id, transaction);
    }
    if (hasNumericOverridePrice) order.totalPrice = overridePrice;
    if (overrides.deliveryAddress) order.deliveryAddress = overrides.deliveryAddress;
    await order.save({ transaction });

    return { ok: true, alreadyProcessed: false, order, inventory };
  });

  if (!result.ok) return result;

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

  if (result.order.paymentStatus === "paid") {
    try {
      result.shipment = await createCdekShipmentForOrder(parsedOrderId);
    } catch (error) {
      // Оплата и резерв уже подтверждены. Повтор выполнит фоновая задача.
      console.error(`[CDEK] Shipment creation failed for paid order ${parsedOrderId}:`, error.message);
    }
  }

  return result;
};

module.exports = { finalizePaidOrder };
