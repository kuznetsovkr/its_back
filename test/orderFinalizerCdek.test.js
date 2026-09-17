const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");

const calls = {
  awaiting: [],
  ready: [],
  create: [],
  telegram: 0,
};

const transaction = { LOCK: { UPDATE: "UPDATE" } };
const order = {
  id: 73,
  inventoryId: 12,
  paymentProvider: null,
  paymentStatus: "pending",
  paykeeperPaymentId: null,
  paidAt: null,
  status: "Ожидание оплаты",
  async save() {},
  toJSON() {
    return { ...this };
  },
};

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

mockModule("../db", {
  transaction: async (callback) => callback(transaction),
});
mockModule("../models/Order", {
  findByPk: async (id) => Number(id) === order.id ? order : null,
});
mockModule("../models/PaymentEvent", {
  findOrCreate: async () => [{}, true],
});
mockModule("../models/OrderAttachment", {
  findAll: async () => [],
});
mockModule("../services/lowStockMonitor", {
  checkItemAndNotify: async () => {},
});
mockModule("../services/inventoryReservations", {
  commitReservationForOrder: async () => ({ id: order.inventoryId }),
});
mockModule("../services/cdekShipments", {
  createCdekShipmentForOrder: async (orderId) => {
    calls.create.push(orderId);
    return { ok: true };
  },
  markCdekShipmentAwaitingFulfillment: async (orderId) => {
    calls.awaiting.push(orderId);
  },
  markCdekShipmentReady: async (orderId) => {
    calls.ready.push(orderId);
  },
});
mockModule("../telegram", async () => {
  calls.telegram += 1;
});

delete require.cache[require.resolve("../services/orderFinalizer")];
const { finalizePaidOrder } = require("../services/orderFinalizer");
const previousAutoShipment = process.env.ENABLE_CDEK_AUTO_SHIPMENT;

beforeEach(() => {
  calls.awaiting.length = 0;
  calls.ready.length = 0;
  calls.create.length = 0;
  calls.telegram = 0;
  Object.assign(order, {
    paymentProvider: null,
    paymentStatus: "pending",
    paykeeperPaymentId: null,
    paidAt: null,
    status: "Ожидание оплаты",
  });
});

after(() => {
  if (previousAutoShipment === undefined) delete process.env.ENABLE_CDEK_AUTO_SHIPMENT;
  else process.env.ENABLE_CDEK_AUTO_SHIPMENT = previousAutoShipment;
});

test("paid order waits for fulfillment when automatic CDEK shipment is disabled", async () => {
  process.env.ENABLE_CDEK_AUTO_SHIPMENT = "0";

  const result = await finalizePaidOrder({
    orderId: order.id,
    provider: "paykeeper",
    eventId: "payment-auto-off",
    paymentConfirmed: true,
    overrides: { paymentId: "pk-auto-off" },
  });

  assert.equal(result.ok, true);
  assert.equal(order.paymentStatus, "paid");
  assert.equal(order.status, "Оплачено");
  assert.deepEqual(calls.awaiting, [order.id]);
  assert.deepEqual(calls.ready, []);
  assert.deepEqual(calls.create, []);
  assert.equal(calls.telegram, 1);
});

test("explicit automatic mode preserves the ready-and-create workflow", async () => {
  process.env.ENABLE_CDEK_AUTO_SHIPMENT = "1";

  const result = await finalizePaidOrder({
    orderId: order.id,
    provider: "paykeeper",
    eventId: "payment-auto-on",
    paymentConfirmed: true,
    overrides: { paymentId: "pk-auto-on" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.awaiting, []);
  assert.deepEqual(calls.ready, [order.id]);
  assert.deepEqual(calls.create, [order.id]);
  assert.equal(calls.telegram, 1);
});
