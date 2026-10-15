const Inventory = require("../models/Inventory");
const OrderItem = require("../models/OrderItem");
const InventoryReservation = require("../models/InventoryReservation");
const { ReservationError } = require("./inventoryReservations");

const loadGroupReservations = async (orderId, transaction) => {
  const rows = await InventoryReservation.findAll({ where: { orderId }, order: [["inventoryId", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
  const items = await OrderItem.findAll({ where: { orderId }, raw: true, transaction });
  const expected = new Map();
  for (const item of items) expected.set(item.inventoryId, (expected.get(item.inventoryId) || 0) + item.quantity);
  if (!items.length || rows.length !== expected.size || rows.some((row) => expected.get(row.inventoryId) !== row.quantity)) {
    throw new ReservationError("Резерв корзины требует проверки менеджером", "cart_reservation_incomplete", 422);
  }
  return rows;
};
const inventoryResult = (inventories) => ({ id: inventories[0]?.id, inventoryIds: inventories.map((item) => item.id) });
const assertGroupReservation = async (orderId, transaction) => {
  const rows = await loadGroupReservations(orderId, transaction);
  if (rows.some((row) => row.status !== "active")) throw new ReservationError("Резерв корзины уже недействителен", "reservation_inactive");
  if (rows.some((row) => new Date(row.expiresAt).getTime() <= Date.now())) throw new ReservationError("Срок резерва корзины истёк", "reservation_expired");
  return rows[0];
};
const commitGroupReservation = async (order, transaction) => {
  const rows = await loadGroupReservations(order.id, transaction);
  const inventories = [];
  for (const row of rows) {
    const inventory = await Inventory.findByPk(row.inventoryId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!inventory || (row.status === "released" && inventory.quantity < row.quantity)) {
      throw new ReservationError("Оплата получена, но для всей корзины недостаточно изделий. Нужна проверка менеджера", "paid_order_out_of_stock");
    }
    if (row.status === "released") { inventory.quantity -= row.quantity; await inventory.save({ transaction }); }
    if (row.status !== "committed") await row.update({ status: "committed", committedAt: new Date(), releasedAt: null, releaseReason: null }, { transaction });
    inventories.push(inventory);
  }
  return inventoryResult(inventories);
};
const releaseGroupReservation = async (orderId, transaction, reason) => {
  const rows = await loadGroupReservations(orderId, transaction);
  const inventories = [];
  for (const row of rows) {
    if (row.status !== "active") continue;
    const inventory = await Inventory.findByPk(row.inventoryId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!inventory) throw new ReservationError("Складская позиция корзины требует проверки", "inventory_not_found", 422);
    inventory.quantity += row.quantity;
    await inventory.save({ transaction });
    await row.update({ status: "released", releasedAt: new Date(), releaseReason: reason }, { transaction });
    inventories.push(inventory);
  }
  return inventoryResult(inventories);
};
module.exports = { assertGroupReservation, commitGroupReservation, releaseGroupReservation };
