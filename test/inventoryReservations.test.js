const assert = require("node:assert/strict");
const { test } = require("node:test");

const transaction = { LOCK: { UPDATE: "UPDATE" } };
const sequelize = {
  transaction: async (callback) => callback(transaction),
};

const inventory = {
  id: 7,
  quantity: 2,
  async save() {},
};
const order = { id: 41, inventoryId: 7 };
let reservation;
let shipment;

const Inventory = {
  findByPk: async (id) => id === inventory.id ? inventory : null,
};
const Order = {
  create: async (values) => Object.assign(order, values),
};
const InventoryReservation = {
  create: async (values) => {
    reservation = {
      ...values,
      async save() {},
    };
    return reservation;
  },
  findOne: async ({ where }) => where.orderId === order.id ? reservation : null,
};
const OrderShipment = {
  create: async (values) => {
    shipment = values;
    return shipment;
  },
  update: async () => [1],
};

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

mockModule("../db", sequelize);
mockModule("../models/Inventory", Inventory);
mockModule("../models/Order", Order);
mockModule("../models/InventoryReservation", InventoryReservation);
mockModule("../models/OrderShipment", OrderShipment);

const {
  RESERVATION_STATUS,
  commitReservationForOrder,
  createOrderWithReservation,
  releaseReservationForOrder,
} = require("../services/inventoryReservations");

test("draft order atomically reserves stock and keeps CDEK shipment pending", async () => {
  const result = await createOrderWithReservation({
    inventoryId: inventory.id,
    orderValues: { status: "Ожидание оплаты" },
    shipmentValues: {
      provider: "cdek",
      tariffCode: 136,
      deliveryPoint: "PVZ1",
      recipientName: "Иван Иванов",
      recipientPhone: "+79991234567",
      declaredValue: 6500,
    },
  });

  assert.equal(inventory.quantity, 1);
  assert.equal(result.reservation.status, RESERVATION_STATUS.ACTIVE);
  assert.equal(result.reservation.inventoryId, inventory.id);
  assert.equal(shipment.status, "pending_payment");
});

test("payment commits an active reservation without decrementing stock twice", async () => {
  const quantityBeforePayment = inventory.quantity;
  await commitReservationForOrder({ order, transaction });

  assert.equal(inventory.quantity, quantityBeforePayment);
  assert.equal(reservation.status, RESERVATION_STATUS.COMMITTED);
  assert.ok(reservation.committedAt instanceof Date);
});

test("cancellation releases an active reservation exactly once", async () => {
  reservation.status = RESERVATION_STATUS.ACTIVE;
  reservation.committedAt = null;
  inventory.quantity = 1;

  await releaseReservationForOrder(order.id, "cancelled");
  assert.equal(inventory.quantity, 2);
  assert.equal(reservation.status, RESERVATION_STATUS.RELEASED);
  assert.equal(reservation.releaseReason, "cancelled");

  await releaseReservationForOrder(order.id, "cancelled");
  assert.equal(inventory.quantity, 2);
});
