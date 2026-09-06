const assert = require("node:assert/strict");
const { test } = require("node:test");

const transaction = { LOCK: { UPDATE: "UPDATE" } };
const sequelize = { transaction: async (callback) => callback(transaction) };
const shipment = {
  orderId: 15,
  provider: "cdek",
  status: "pending_payment",
  processingStartedAt: null,
};

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

mockModule("../db", sequelize);
mockModule("../models/OrderShipment", {
  findOne: async () => shipment,
});
mockModule("../models/Order", {
  findByPk: async () => ({ id: 15, paymentStatus: "pending" }),
});
mockModule("../models/Inventory", {
  findByPk: async () => {
    throw new Error("inventory must not be read for an unpaid order");
  },
});
mockModule("../telegram", { sendOrderIssueToTelegram: async () => 0 });

const { createCdekShipmentForOrder } = require("../services/cdekShipments");

test("CDEK shipment worker refuses an unpaid order", async () => {
  const result = await createCdekShipmentForOrder(15);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, "not_paid");
  assert.equal(shipment.status, "pending_payment");
});
