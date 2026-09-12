const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const express = require("express");

const SECRET = "test-paykeeper-secret-seed";
const ORDER_ID = 42;
const ORDER_TOTAL = 6100;
const finalizedPayments = [];

const order = {
  id: ORDER_ID,
  totalPrice: ORDER_TOTAL,
  status: "Ожидание оплаты",
  paidAt: null,
  async update(values) {
    Object.assign(this, values);
  },
  toJSON() {
    return { ...this };
  },
};

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

mockModule("../db", {
  transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }),
});
mockModule("../lib/paykeeper", {
  createInvoice: async () => ({ invoice_id: "invoice-1", pay_url: "https://pay.example" }),
});
mockModule("../models/Order", {
  findByPk: async (id) => (Number(id) === ORDER_ID ? order : null),
});
mockModule("../services/orderFinalizer", {
  finalizePaidOrder: async (payload) => {
    finalizedPayments.push(payload);
    return { ok: true, alreadyProcessed: false, order };
  },
});
mockModule("../telegram", { sendOrderIssueToTelegram: async () => 0 });
mockModule("../services/inventoryReservations", {
  ReservationError: class ReservationError extends Error {},
  assertActiveReservation: async () => true,
});
mockModule("../middleware/orderAccess", {
  canAccessOrder: () => true,
  requireOrderAccess: (_req, _res, next) => next(),
});
mockModule("../middleware/rateLimit", {
  paymentCallbackRateLimit: (_req, _res, next) => next(),
  paymentLinkRateLimit: (_req, _res, next) => next(),
});

delete require.cache[require.resolve("../routes/payments.paykeeper")];
const paykeeperRouter = require("../routes/payments.paykeeper");

const signature = ({ id, sum, clientid, orderid }) =>
  crypto
    .createHash("md5")
    .update(`${id}${Number(sum).toFixed(2)}${clientid}${orderid}${SECRET}`)
    .digest("hex");

const callbackBody = (overrides = {}) => {
  const fields = {
    id: "payment-test-1",
    sum: ORDER_TOTAL.toFixed(2),
    clientid: "Тестовый покупатель",
    orderid: String(ORDER_ID),
    ...overrides,
  };
  return new URLSearchParams({ ...fields, key: overrides.key || signature(fields) });
};

test("PayKeeper callback verifies its signature and server-side order amount", async (t) => {
  const previousSecret = process.env.PAYKEEPER_SECRET_SEED;
  const previousConsoleWarn = console.warn;
  process.env.PAYKEEPER_SECRET_SEED = SECRET;
  console.warn = () => {};
  finalizedPayments.length = 0;

  const app = express();
  app.use("/payments/paykeeper", paykeeperRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  t.after(async () => {
    if (previousSecret === undefined) delete process.env.PAYKEEPER_SECRET_SEED;
    else process.env.PAYKEEPER_SECRET_SEED = previousSecret;
    console.warn = previousConsoleWarn;
    await new Promise((resolve) => server.close(resolve));
  });

  const endpoint = `http://127.0.0.1:${server.address().port}/payments/paykeeper/callback`;
  const validResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody(),
  });
  assert.equal(validResponse.status, 200);
  assert.equal(
    await validResponse.text(),
    `OK ${crypto.createHash("md5").update(`payment-test-1${SECRET}`).digest("hex")}`
  );
  assert.deepEqual(finalizedPayments, [{
    orderId: ORDER_ID,
    provider: "paykeeper",
    eventId: "pk-payment-test-1",
    paymentConfirmed: true,
    overrides: { paymentId: "payment-test-1" },
  }]);

  const invalidSignatureResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody({ key: "0".repeat(32) }),
  });
  assert.equal(invalidSignatureResponse.status, 400);
  assert.equal(finalizedPayments.length, 1);

  const wrongAmountResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody({ sum: "1.00" }),
  });
  assert.equal(wrongAmountResponse.status, 400);
  assert.equal(finalizedPayments.length, 1);
});
