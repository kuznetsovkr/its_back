const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.JWT_SECRET = "test-only-jwt-secret-that-is-long-enough";
process.env.ADMIN_PHONE = "79990000000";
process.env.ADMIN_PASSWORD = "test-only-admin-password";

test("admin login validates JSON strictly and rate-limits each account", async (t) => {
  const express = require("express");
  const authRoutes = require("../routes/authRoutes");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/admin-login`;

  const unknownFieldResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "79990000002", password: "wrong", role: "admin" }),
  });
  assert.equal(unknownFieldResponse.status, 400);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "79990000001", password: "wrong" }),
    });
    assert.equal(response.status, 401);
  }
  const limitedResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "79990000001", password: "wrong" }),
  });
  assert.equal(limitedResponse.status, 429);
  assert.ok(limitedResponse.headers.get("retry-after"));

  const successResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: process.env.ADMIN_PHONE,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  assert.equal(successResponse.status, 200);
});
