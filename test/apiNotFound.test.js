const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { apiNotFound } = require("../middleware/notFound");

test("unknown API and payment endpoints return a JSON 404", async (t) => {
  const app = express();
  app.use("/api", apiNotFound);
  app.use("/payments", apiNotFound);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  for (const path of ["/api/not-found", "/payments/paykeeper/ping"]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.deepEqual(await response.json(), {
      message: "Маршрут API не найден",
      code: "api_route_not_found",
    });
  }
});
