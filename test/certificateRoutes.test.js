const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { createCertificateRouter } = require("../routes/certificateRoutes");
const { createCertificateAccessToken } = require("../middleware/certificateAccess");

test("certificate routes require buyer-scoped access, trusted origin and bounded purchase attempts", async (t) => {
  const names = ["NODE_ENV", "PUBLIC_APP_URL", "ALLOWED_PUBLIC_ORIGINS", "CERTIFICATE_ACCESS_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, { NODE_ENV: "production", PUBLIC_APP_URL: "https://shop.example", ALLOWED_PUBLIC_ORIGINS: "https://shop.example", CERTIFICATE_ACCESS_SECRET: "b2".repeat(32) });
  const purchases = [];
  const payments = [];
  const app = express();
  app.use(express.json());
  app.use("/cert", createCertificateRouter({
    getPublicCertificateConfig: () => ({ enabled: false, denominations: [1000] }),
    beginCertificateCheckout: async (input) => { purchases.push(input); return { certificateId: 42 }; },
    createCertificatePaymentLink: async (id) => { payments.push(id); return { pay_url: "https://pay.example/bill/1/" }; },
    getCertificatePurchaseStatus: async (id) => ({ certificateId: id, paid: false }),
  }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(async () => {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    await new Promise((resolve) => server.close(resolve));
  });
  const url = "http://127.0.0.1:" + server.address().port + "/cert";
  const headers = { "Content-Type": "application/json", Origin: "https://shop.example", "X-Certificate-Access-Token": createCertificateAccessToken(42) };
  const request = (path, body = {}, customHeaders = headers) => fetch(url + path, { method: "POST", headers: customHeaders, body: JSON.stringify(body) });
  assert.equal((await fetch(url + "/42/status")).status, 403);
  assert.equal((await fetch(url + "/43/status", { headers })).status, 403);
  const status = await fetch(url + "/42/status", { headers });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  assert.deepEqual(await status.json(), { certificateId: 42, paid: false });
  assert.equal((await request("/42/payment", {}, { ...headers, Origin: "https://evil.example" })).status, 403);
  assert.equal((await request("/42/payment", {}, { "Content-Type": "application/json", "X-Certificate-Access-Token": headers["X-Certificate-Access-Token"] })).status, 403);
  assert.equal((await request("/42/payment", { paymentAmountKopecks: 1 })).status, 400);
  assert.equal((await request("/42/payment")).status, 200);
  assert.deepEqual(payments, [42]);
  assert.equal((await request("/purchase", {}, { ...headers, Origin: "https://evil.example" })).status, 403);
  for (let attempt = 0; attempt < 7; attempt += 1) await request("/purchase", {}, { ...headers, "Idempotency-Key": "fixture" });
  const limited = await request("/purchase");
  assert.equal(limited.status, 429);
  assert.equal(purchases.length, 6);
});
