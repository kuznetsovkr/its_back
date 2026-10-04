const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const express = require("express");
const { createCertificateAdminRouter } = require("../routes/certificateAdminRoutes");
const { toAdminCertificate } = require("../services/certificateAdmin");

test("admin certificate DTO never exposes bearer codes, hashes or encrypted copies", () => {
  const dto = toAdminCertificate({ id: 1, buyerFullName: "Иван", buyerEmail: "fixture@example.com", nominalKopecks: 100000,
    balanceKopecks: 60000, testMode: false, status: "active", paidAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
    codeHash: "private", codeEncrypted: "private", purchaseRequestHash: "private" }, 10000, { status: "sent" });
  assert.equal(dto.balance, 600);
  assert.equal(dto.reserved, 100);
  assert.equal(dto.available, 500);
  assert.equal(dto.statusLabel, "Активен");
  assert.equal(JSON.stringify(dto).includes("private"), false);
});
test("admin certificates require the configured admin and validate pagination", async (t) => {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, ADMIN_PHONE: process.env.ADMIN_PHONE };
  process.env.JWT_SECRET = "fixture-admin-secret-".repeat(3);
  process.env.ADMIN_PHONE = "79991234567";
  const calls = [];
  const app = express();
  app.use("/admin", createCertificateAdminRouter({ listCertificates: async (input) => { calls.push(input); return { items: [], total: 0, ...input }; }, certificateHistory: async (input) => input }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(async () => {
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/admin`;
  const headers = { Authorization: "Bearer " + jwt.sign({ role: "admin", phone: process.env.ADMIN_PHONE }, process.env.JWT_SECRET) };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer " + jwt.sign({ role: "admin", phone: "79990000000" }, process.env.JWT_SECRET) } })).status, 403);
  assert.equal((await fetch(url + "?pageSize=101", { headers })).status, 400);
  assert.equal((await fetch(url + "?page=-1", { headers })).status, 400);
  assert.equal((await fetch(url + "?code=secret", { headers })).status, 400);
  const response = await fetch(url + "?page=2&pageSize=10", { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [{ page: 2, pageSize: 10 }]);
  const history = await fetch(url + "/42/history", { headers });
  assert.deepEqual(await history.json(), { page: 1, pageSize: 25, id: 42 });
});
