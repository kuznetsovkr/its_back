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
    clothingType: {
      code: "hoodie",
      patronusLimit: 5,
      patronusPrice: 10000,
      carPrice: 8500,
      carSimplePrice: 6500, carMediumPrice: 8500, carComplexPrice: 11500,
      petFacePrice: 8000,
      packageWidth: 35,
      packageHeight: 35,
      packageLength: 7,
      packageWeight: 800,
    },
  }),
});
mockModule("../services/orderPricing", {
  ...actualPricing,
  calculateCdekDelivery: async ({ merchandisePrice }) => {
    assert.equal(merchandisePrice > 0, true);
    return { deliveryPrice: 477.75, insurancePrice: 78.75 };
  },
});
mockModule("../services/pricingConfig", {
  getPricingConfig: async () => ({}),
  getPricingExtras: async () => ({ Patronus: 5000, petFace: 2000 }),
  updatePricingConfig: async () => {},
});

const pricingRoutes = require("../routes/pricingRoutes");
const { issueCitySelection } = require("../lib/deliveryCity");

test("checkout quote returns a server-calculated delivery and total", async (t) => {
  const previousTestMode = process.env.PAYKEEPER_TEST_MODE;
  const previousCitySecret = process.env.ORDER_ACCESS_SECRET;
  process.env.PAYKEEPER_TEST_MODE = "1";
  process.env.ORDER_ACCESS_SECRET = "checkout-quote-city-test-secret";
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/pricing", pricingRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(async () => {
    if (previousTestMode === undefined) delete process.env.PAYKEEPER_TEST_MODE;
    else process.env.PAYKEEPER_TEST_MODE = previousTestMode;
    if (previousCitySecret === undefined) delete process.env.ORDER_ACCESS_SECRET;
    else process.env.ORDER_ACCESS_SECRET = previousCitySecret;
    await new Promise((resolve) => server.close(resolve));
  });

  const url = `http://127.0.0.1:${server.address().port}/pricing/checkout`;
  const body = {
    productType: "Худи",
    color: "Чёрный",
    size: "M",
    embroideryType: "Car",
    carDesign: "medium",
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
  assert.equal(result.deliveryPrice, 477.75);
  assert.equal(result.insurancePrice, 78.75);
  assert.equal(result.totalPrice, 8977.75);
  assert.equal(result.paymentAmount, 1);
  assert.equal(result.paymentTestMode, true);

  const city = issueCitySelection({ id: "test-city", name: "Москва", label: "г Москва", longitude: 37.6, latitude: 55.7 });
  const postalBody = { ...body, cdekMode: undefined, cdekAddress: undefined,
    deliveryMethod: "russian_post", postalPoint: "101000, Москва, отделение 1", deliveryCityToken: city.token };
  const postalQuote = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(postalBody),
  });
  const postalResult = await postalQuote.json();
  assert.equal(postalQuote.status, 200);
  assert.equal(postalResult.manual, false);
  assert.equal(postalResult.merchandisePrice, 8500);
  assert.equal(postalResult.totalPrice, 8500);
  assert.equal(postalResult.deliveryPrice, null);
  assert.equal(postalResult.deliveryPayLater, true);
  assert.equal(postalResult.paymentAmount, 1);
  for (const invalid of [
    { deliveryCityToken: "forged-city" }, { postalPoint: "" },
    { cdekMode: "office", cdekAddress: { code: "KRS1" } },
  ]) {
    const rejectedPostal = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...postalBody, ...invalid }),
    });
    assert.equal(rejectedPostal.status, 400);
  }

  const rejected = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, totalPrice: 1 }),
  });
  assert.equal(rejected.status, 400);

  const quoteUrl = `http://127.0.0.1:${server.address().port}/pricing/quote`;
  const quote = (patronusCount, petFaceCount) => fetch(quoteUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productType: body.productType,
      color: body.color,
      size: body.size,
      patronusCount,
      petFaceCount,
    }),
  });
  const fourPatronuses = await quote(4, 5);
  assert.equal(fourPatronuses.status, 200);
  assert.deepEqual((await fourPatronuses.json()).prices, {
    Patronus: 25000, Car: 6500, petFace: 16000,
  });
  const fivePatronuses = await quote(5, 5);
  assert.equal(fivePatronuses.status, 400);
  assert.match((await fivePatronuses.json()).message, /не более 4 патронусов/);
  const sixPetFaces = await quote(4, 6);
  assert.equal(sixPetFaces.status, 400);
  assert.match((await sixPetFaces.json()).message, /не более 5 портретов/);

  const checkout = (embroideryType, patronusCount, petFaceCount) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, embroideryType, patronusCount, petFaceCount }),
  });
  assert.equal((await checkout("Patronus", 4, 1)).status, 200);
  assert.equal((await checkout("Patronus", 5, 1)).status, 400);
  assert.equal((await checkout("petFace", 1, 5)).status, 200);
  assert.equal((await checkout("petFace", 1, 6)).status, 400);
  assert.equal((await checkout("Car", 5, 1)).status, 200);
});
