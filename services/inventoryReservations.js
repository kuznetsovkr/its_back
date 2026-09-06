const { Op } = require("sequelize");
const sequelize = require("../db");
const Inventory = require("../models/Inventory");
const Order = require("../models/Order");
const InventoryReservation = require("../models/InventoryReservation");
const OrderShipment = require("../models/OrderShipment");

const RESERVATION_STATUS = Object.freeze({
  ACTIVE: "active",
  COMMITTED: "committed",
  RELEASED: "released",
});

class ReservationError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = "ReservationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const getReservationTtlMs = () => {
  const configured = Number(process.env.ORDER_RESERVATION_TTL_MINUTES || 30);
  const minutes = Number.isFinite(configured)
    ? Math.min(1440, Math.max(5, Math.floor(configured)))
    : 30;
  return minutes * 60 * 1000;
};

const createOrderWithReservation = async ({ inventoryId, orderValues, shipmentValues = null }) =>
  sequelize.transaction(async (transaction) => {
    const inventory = await Inventory.findByPk(inventoryId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!inventory || inventory.quantity < 1) {
      throw new ReservationError("Недостаточно товара на складе", "insufficient_stock");
    }

    inventory.quantity -= 1;
    await inventory.save({ transaction });

    const order = await Order.create({ ...orderValues, inventoryId: inventory.id }, { transaction });
    const reservation = await InventoryReservation.create({
      orderId: order.id,
      inventoryId: inventory.id,
      quantity: 1,
      status: RESERVATION_STATUS.ACTIVE,
      expiresAt: new Date(Date.now() + getReservationTtlMs()),
    }, { transaction });

    if (shipmentValues) {
      await OrderShipment.create({
        ...shipmentValues,
        orderId: order.id,
        status: "pending_payment",
      }, { transaction });
    }

    return { inventory, order, reservation };
  });

const lockInventoryForOrder = async (order, transaction) => {
  if (!order.inventoryId) {
    throw new ReservationError("У заказа не указана складская позиция", "inventory_not_linked", 422);
  }
  const inventory = await Inventory.findByPk(order.inventoryId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!inventory) {
    throw new ReservationError("Складская позиция заказа не найдена", "inventory_not_found", 422);
  }
  return inventory;
};

const commitReservationForOrder = async ({ order, transaction }) => {
  let reservation = await InventoryReservation.findOne({
    where: { orderId: order.id },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (reservation?.status === RESERVATION_STATUS.COMMITTED) {
    return lockInventoryForOrder(order, transaction);
  }

  const inventory = await lockInventoryForOrder(order, transaction);
  if (!reservation || reservation.status === RESERVATION_STATUS.RELEASED) {
    if (inventory.quantity < 1) {
      throw new ReservationError(
        "Оплата получена после истечения резерва, товара нет в наличии",
        "paid_order_out_of_stock"
      );
    }
    inventory.quantity -= 1;
    await inventory.save({ transaction });
  }

  if (!reservation) {
    reservation = await InventoryReservation.create({
      orderId: order.id,
      inventoryId: inventory.id,
      quantity: 1,
      status: RESERVATION_STATUS.COMMITTED,
      expiresAt: new Date(),
      committedAt: new Date(),
    }, { transaction });
  } else {
    reservation.status = RESERVATION_STATUS.COMMITTED;
    reservation.committedAt = reservation.committedAt || new Date();
    reservation.releasedAt = null;
    reservation.releaseReason = null;
    await reservation.save({ transaction });
  }

  return inventory;
};

const releaseLockedReservation = async ({ reservation, transaction, reason }) => {
  if (!reservation || reservation.status !== RESERVATION_STATUS.ACTIVE) return null;
  const inventory = await Inventory.findByPk(reservation.inventoryId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (inventory) {
    inventory.quantity += reservation.quantity;
    await inventory.save({ transaction });
  }
  reservation.status = RESERVATION_STATUS.RELEASED;
  reservation.releasedAt = new Date();
  reservation.releaseReason = reason;
  await reservation.save({ transaction });
  return inventory;
};

const releaseReservationForOrder = async (
  orderId,
  reason = "cancelled",
  existingTransaction = null
) => {
  const release = async (transaction) => {
    const reservation = await InventoryReservation.findOne({
      where: { orderId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const inventory = await releaseLockedReservation({ reservation, transaction, reason });
    if (reservation?.status === RESERVATION_STATUS.RELEASED) {
      await OrderShipment.update(
        { status: "cancelled", lastError: `Reservation ${reason}` },
        { where: { orderId, status: "pending_payment" }, transaction }
      );
    }
    return inventory;
  };

  if (existingTransaction) return release(existingTransaction);
  return sequelize.transaction(release);
};

const assertActiveReservation = async (orderId, existingTransaction = null) => {
  const assertReservation = async (transaction) => {
    const reservation = await InventoryReservation.findOne({
      where: { orderId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    // Старые заказы до появления резервов остаются совместимыми.
    if (!reservation) return null;
    if (reservation.status !== RESERVATION_STATUS.ACTIVE) {
      throw new ReservationError("Резерв товара уже недействителен", "reservation_inactive");
    }
    if (new Date(reservation.expiresAt).getTime() <= Date.now()) {
      throw new ReservationError("Срок резерва товара истёк", "reservation_expired");
    }
    return reservation;
  };

  if (existingTransaction) return assertReservation(existingTransaction);
  return sequelize.transaction(assertReservation);
};

const releaseExpiredReservations = async ({ limit = 100 } = {}) => {
  const candidates = await InventoryReservation.findAll({
    where: {
      status: RESERVATION_STATUS.ACTIVE,
      expiresAt: { [Op.lte]: new Date() },
    },
    attributes: ["id", "orderId"],
    order: [["expiresAt", "ASC"]],
    limit,
    raw: true,
  });
  const releasedInventoryIds = [];

  for (const candidate of candidates) {
    const releasedInventoryId = await sequelize.transaction(async (transaction) => {
      const order = await Order.findByPk(candidate.orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const reservation = await InventoryReservation.findByPk(candidate.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!reservation || reservation.status !== RESERVATION_STATUS.ACTIVE) return null;
      if (order?.paymentStatus === "paid") {
        reservation.status = RESERVATION_STATUS.COMMITTED;
        reservation.committedAt = new Date();
        await reservation.save({ transaction });
        return null;
      }

      const inventory = await releaseLockedReservation({
        reservation,
        transaction,
        reason: "expired",
      });
      await OrderShipment.update(
        { status: "cancelled", lastError: "Reservation expired" },
        { where: { orderId: reservation.orderId, status: "pending_payment" }, transaction }
      );
      if (order && ["pending", "manual"].includes(order.paymentStatus)) {
        order.paymentStatus = "expired";
        order.status = "Резерв истёк";
        await order.save({ transaction });
      }
      return inventory?.id || null;
    });
    if (releasedInventoryId) releasedInventoryIds.push(releasedInventoryId);
  }

  return releasedInventoryIds;
};

module.exports = {
  RESERVATION_STATUS,
  ReservationError,
  assertActiveReservation,
  commitReservationForOrder,
  createOrderWithReservation,
  getReservationTtlMs,
  releaseExpiredReservations,
  releaseReservationForOrder,
};
