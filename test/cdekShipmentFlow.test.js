const assert = require("node:assert/strict");
const { test } = require("node:test");

const { buildCdekOrderPayload } = require("../services/cdekShipments");

test("CDEK shipment payload charges nothing on delivery and uses server parcel data", () => {
  const payload = buildCdekOrderPayload({
    order: { id: 77, productType: "Футболка" },
    inventory: { productType: "Футболка" },
    shipment: {
      tariffCode: 136,
      deliveryPoint: "MSK123",
      recipientName: "Иван Иванов",
      recipientPhone: "+79991234567",
      declaredValue: 6500,
    },
  });

  assert.equal(payload.number, "77");
  assert.equal(payload.delivery_point, "MSK123");
  assert.equal(payload.packages[0].weight, 300);
  assert.equal(payload.packages[0].items[0].cost, 6500);
  assert.equal(payload.packages[0].items[0].payment.value, 0);
  assert.equal(payload.delivery_recipient_cost.value, 0);
});

test("public CDEK endpoint no longer accepts shipment creation", async (t) => {
  const express = require("express");
  const cdekServiceRoutes = require("../routes/cdekServiceRoutes");
  const app = express();
  app.use(express.json());
  app.use(cdekServiceRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/service.php?action=create_order`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_order", number: 77 }),
    }
  );
  assert.equal(response.status, 400);
});
