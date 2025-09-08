const sequelize = require("../db");
const Order = require("../models/Order");
const Inventory = require("../models/Inventory");
const PaymentEvent = require("../models/PaymentEvent");
const { checkItemAndNotify } = require("../services/lowStockMonitor");
const sendOrderToTelegram = require("../telegram");
const OrderAttachment = require("../models/OrderAttachment");

async function finalizePaidOrder({ orderId, provider = "manual", eventId, overrides = {} }) {
  if (!orderId) throw new Error("orderId is required");
  if (!eventId) eventId = `${provider}-${orderId}`;

  const t = await sequelize.transaction();
  try {
    // 1) Идемпотентность
    await PaymentEvent.findOrCreate({
      where: { eventId },
      defaults: { provider, orderId, payload: overrides || {} },
      transaction: t,
    });

    // 2) Лочим заказ
    const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!order) {
      await t.rollback();
      return { ok: false, message: "Заказ не найден" };
    }

    // ✅ Если уже финализирован — просто выходим, НИЧЕГО не шлём повторно
    if (order.status === "Оплачено") {
      await t.commit();
      return { ok: true, alreadyProcessed: true, order };
    }

    // Без подтверждённой оплаты финализацию не проводим
    if (order.paymentStatus !== "paid") {
      await t.rollback();
      return { ok: false, message: "Оплата ещё не подтверждена" };
    }

    // 3) Списываем со склада
    let item;
    if (order.inventoryId) {
      item = await Inventory.findByPk(order.inventoryId, { transaction: t, lock: t.LOCK.UPDATE });
    } else {
      const { findInventoryForOrder } = require("./inventoryResolver");
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

    // 4) Обновляем заказ
    order.status = "Оплачено";
    order.paidAt = order.paidAt || new Date();
    if (overrides.totalPrice) order.totalPrice = overrides.totalPrice;
    if (overrides.deliveryAddress) order.deliveryAddress = overrides.deliveryAddress;
    await order.save({ transaction: t });

    // Коммитим транзакцию
    await t.commit();

    // 5) Пост-коммит: low-stock
    try {
      await checkItemAndNotify(item.id);
    } catch (e) {
      console.error("Low-stock notify error:", e);
    }

    // 6) Пост-коммит: ОДНА отправка в Телеграм с вложениями
    try {
      const files = await OrderAttachment.findAll({ where: { orderId }, raw: true });
      await sendOrderToTelegram(order.toJSON(), files); // ⬅️ передаём массив вложений
    } catch (e) {
      console.error("Telegram send error:", e);
    }

    return { ok: true, order };
  } catch (e) {
    await t.rollback();
    console.error("❌ finalizePaidOrder error:", e);
    throw e;
  }
}

module.exports = { finalizePaidOrder };
