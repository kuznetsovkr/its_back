const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const express = require("express");

const SECRET = "test-paykeeper-secret-seed";
const ORDER_ID = 42;
const ORDER_TOTAL = 6100;
const finalizedPayments = [];
const createdInvoices = [];
const certificatePayments = [];

const order = {
  id: ORDER_ID,
  totalPrice: ORDER_TOTAL,
  paymentAmount: null,
  paymentProvider: null,
  paymentStatus: "pending",
  paykeeperInvoiceId: null,
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
  createInvoice: async (payload) => {
    createdInvoices.push(payload);
    return { invoice_id: "invoice-1", pay_url: "https://pay.example" };
  },
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
mockModule("../services/certificateCheckout", {
  handleCertificatePaykeeperCallback: async (payload) => {
    if (payload.paymentId === "fixture-private-error") throw new Error("fixture-private-certificate-material");
    if (payload.amountKopecks !== 100) {
      const error = new Error("Invalid amount"); error.code = "certificate_payment_amount_mismatch"; error.statusCode = 400; throw error;
    }
    certificatePayments.push(payload);
  },
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

test("PayKeeper link stores and charges the one-ruble test amount", async (t) => {
  const previousMode = process.env.PAYKEEPER_TEST_MODE;
  process.env.PAYKEEPER_TEST_MODE = "1";
  order.paymentAmount = null;
  order.paymentProvider = null;
  order.paymentStatus = "pending";
  order.paykeeperInvoiceId = null;
  createdInvoices.length = 0;

  const app = express();
  app.use(express.json());
  app.use("/payments/paykeeper", paykeeperRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  t.after(async () => {
    if (previousMode === undefined) delete process.env.PAYKEEPER_TEST_MODE;
    else process.env.PAYKEEPER_TEST_MODE = previousMode;
    order.paymentAmount = null;
    order.paymentProvider = null;
    order.paymentStatus = "pending";
    order.paykeeperInvoiceId = null;
    await new Promise((resolve) => server.close(resolve));
  });

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/payments/paykeeper/link`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: ORDER_ID }),
    }
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.payment_amount, 1);
  assert.equal(result.test_mode, true);
  assert.equal(order.totalPrice, ORDER_TOTAL);
  assert.equal(order.paymentAmount, 1);
  assert.equal(createdInvoices[0].pay_amount, "1.00");
});

test("PayKeeper callback verifies its signature and server-side order amount", async (t) => {
  const previousSecret = process.env.PAYKEEPER_SECRET_SEED;
  const previousConsoleWarn = console.warn;
  process.env.PAYKEEPER_SECRET_SEED = SECRET;
  order.paymentAmount = null;
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
    order.paymentAmount = null;
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
    deferSideEffects: true,
  }]);

  const extendedCallbackResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody({
      id: "payment-test-extended",
      service_name: "Order payment",
      client_email: "customer@example.com",
      client_phone: "+79990000000",
      ps_id: "card",
      batch_date: "2026-09-15",
      fop_receipt_key: "receipt-test",
      bank_id: "bank-test",
      card_number: "411111******1111",
      card_holder: "TEST CUSTOMER",
      card_expiry: "12/30",
    }),
  });
  assert.equal(extendedCallbackResponse.status, 200);
  assert.equal(finalizedPayments.length, 2);

  const invalidSignatureResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody({ key: "0".repeat(32) }),
  });
  assert.equal(invalidSignatureResponse.status, 400);
  assert.equal(finalizedPayments.length, 2);

  const wrongAmountResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody({ sum: "1.00" }),
  });
  assert.equal(wrongAmountResponse.status, 400);
  assert.equal(finalizedPayments.length, 2);

  order.paymentAmount = 1;
  const testAmountResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody({ id: "payment-test-2", sum: "1.00" }),
  });
  assert.equal(testAmountResponse.status, 200);
  assert.equal(finalizedPayments.length, 3);
});

test("PayKeeper dispatches only signed certificate callbacks and rejects their wrong amount", async (t) => {
  const previous = process.env.PAYKEEPER_SECRET_SEED;
  const previousConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);
  process.env.PAYKEEPER_SECRET_SEED = SECRET;
  const app = express();
  app.use("/pk", paykeeperRouter);
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(async () => {
    console.error = previousConsoleError;
    if (previous === undefined) delete process.env.PAYKEEPER_SECRET_SEED; else process.env.PAYKEEPER_SECRET_SEED = previous;
    await new Promise((resolve) => server.close(resolve));
  });
  const send = (overrides) => fetch("http://127.0.0.1:" + server.address().port + "/pk/callback", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: callbackBody({ orderid: "certificate-42", sum: "1.00", ...overrides }),
  });
  const before = finalizedPayments.length;
  assert.equal((await send({})).status, 200);
  assert.deepEqual(certificatePayments, [{ certificateId: 42, paymentId: "payment-test-1", amountKopecks: 100 }]);
  assert.equal((await send({ key: "0".repeat(32) })).status, 400);
  assert.equal((await send({ sum: "2.00" })).status, 400);
  assert.equal((await send({ id: "fixture-private-error" })).status, 500);
  assert.equal(JSON.stringify(loggedErrors).includes("fixture-private-certificate-material"), false);
  assert.equal(loggedErrors.length, 1);
  assert.equal(certificatePayments.length, 1);
  assert.equal(finalizedPayments.length, before);
});
