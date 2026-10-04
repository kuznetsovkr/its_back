const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { GiftCertificateError } = require("../lib/giftCertificateRules");
const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const calls = [];
const order = { id: 42 };
let covered = true;
mockModule("../models/Order", { findByPk: async (id) => Number(id) === 42 ? order : null });
mockModule("../services/orderFinalizer", { finalizePaidOrder: async (input) => {
  calls.push(input);
  if (!covered) throw new GiftCertificateError("Этот заказ не покрыт сертификатом полностью", "certificate_order_not_covered", 409);
  return { ok: true, order };
} });
const router = require("../routes/orderRoutes");
const { createOrderAccessToken } = require("../middleware/orderAccess");
test("zero-due completion requires one order token, trusted origin and no client amounts", async (t) => {
  const names = ["NODE_ENV", "PUBLIC_APP_URL", "ALLOWED_PUBLIC_ORIGINS", "ORDER_ACCESS_SECRET"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, { NODE_ENV: "production", PUBLIC_APP_URL: "https://shop.example", ALLOWED_PUBLIC_ORIGINS: "https://shop.example", ORDER_ACCESS_SECRET: "fixture-order-secret-".repeat(3) });
  const app = express();
  app.use(express.json());
  app.use("/orders", router);
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(async () => {
    for (const name of names) if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/orders/42/complete-certificate`;
  const headers = { "Content-Type": "application/json", Origin: "https://shop.example", "X-Order-Access-Token": createOrderAccessToken(42) };
  const post = (body = {}, customHeaders = headers) => fetch(url, { method: "POST", headers: customHeaders, body: JSON.stringify(body) });
  assert.equal((await post({}, { "Content-Type": "application/json", Origin: headers.Origin })).status, 401);
  assert.equal((await post({}, { ...headers, "X-Order-Access-Token": createOrderAccessToken(43) })).status, 403);
  assert.equal((await post({}, { ...headers, Origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ amountDue: 0, certificateDiscount: 6000 })).status, 400);
  assert.equal((await post()).status, 200);
  assert.deepEqual(calls, [{ orderId: 42, provider: "certificate", eventId: "certificate-42", paymentConfirmed: true, deferSideEffects: true }]);
  covered = false;
  assert.equal((await post()).status, 409);
});
