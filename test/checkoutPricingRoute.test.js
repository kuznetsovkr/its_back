const assert = require("node:assert/strict");
const { test } = require("node:test");

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const actualPricing = require("../services/orderPricing");
mockModule("../services/inventoryResolver", {
  findInventoryForOrder: async () => ({
    id: 1,
    productType: "Худи",
    quantity: 3,
  }),
});
mockModule("../services/orderPricing", {
  ...actualPricing,
  calculateCdekDelivery: async () => ({ deliveryPrice: 742 }),
});

const pricingRoutes = require("../routes/pricingRoutes");

test("checkout quote returns a server-calculated delivery and total", async (t) => {
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/pricing", pricingRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/pricing/checkout`;
  const body = {
    productType: "Худи",
    color: "Чёрный",
    size: "M",
    embroideryType: "Car",
    patronusCount: 1,
    petFaceCount: 1,
    cdekMode: "office",
    cdekAddress: { code: "KRS1" },
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.merchandisePrice, 8500);
  assert.equal(result.deliveryPrice, 742);
  assert.equal(result.totalPrice, 9242);

  const rejected = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, totalPrice: 1 }),
  });
  assert.equal(rejected.status, 400);
});
