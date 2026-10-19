const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
const express = require("express");
const multer = require("multer");
const { issueCitySelection } = require("../lib/deliveryCity");

const calls = { orders: [], cdekQuotes: [], offices: [], attachments: [], invoices: [] };
const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const inventory = { id: 12, productType: "Худи", color: "Чёрный", size: "M", clothingType: {
  code: "hoodie", patronusLimit: 4, patronusPrice: 10000, carPrice: 8500, petFacePrice: 8000,
  carSimplePrice: 6500, carMediumPrice: 8500, carComplexPrice: 11500,
} };
const pricing = require("../services/orderPricing");
mockModule("../db", { transaction: async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } }) });
mockModule("../models/Order", { findByPk: async () => calls.orders.at(-1)?.order || null });
mockModule("../models/OrderAttachment", { bulkCreate: async (values) => calls.attachments.push(...values) });
mockModule("../models/OrderShipment", {});
mockModule("../services/inventoryResolver", { findInventoryForOrder: async () => inventory });
mockModule("../services/pricingConfig", { getPricingExtras: async () => ({ Patronus: 5000, petFace: 2000 }) });
mockModule("../services/orderPricing", { ...pricing, resolveOffice: async (address) => {
  calls.offices.push(address);
  return { cityCode: 278, office: { code: "KRS1", location: { city: "Красноярск", address: "Мира, 1" } } };
}, calculateCdekDelivery: async (input) => {
  calls.cdekQuotes.push(input);
  return { deliveryPrice: 742, tariffCode: 136, packages: [{ number: "1", length: 35, width: 35, height: 7, weight: 800 }], office: { code: "KRS1", location: { city: "Красноярск", address: "Мира, 1" } } };
} });
mockModule("../services/lowStockMonitor", { checkItemAndNotify: async () => {} });
mockModule("../services/orderFinalizer", {});
mockModule("../services/giftCertificates", {});
mockModule("../services/turnstileVerification", { TurnstileVerificationError: class extends Error {}, verifyTurnstileToken: async () => {} });
mockModule("../services/inventoryReservations", {
  ReservationError: class extends Error {}, assertActiveReservation: async () => {},
  createOrderWithReservation: async (input) => {
    const order = { id: 42, ...input.orderValues };
    calls.orders.push({ ...input, order });
    return { order, reservation: { expiresAt: "2026-10-14T10:00:00Z" } };
  },
});
mockModule("../lib/uploadSecurity", {
  ORDER_UPLOAD_DIR: "C:/fixture-no-files/order-uploads",
  orderImagesUpload: multer({ storage: multer.memoryStorage() }).array("images"),
  validateUploadedImages: (_req, _res, next) => next(),
  cleanupTemporaryFilesAfterResponse: (_req, _res, next) => next(),
  persistValidatedImage: async () => ({ path: "C:/fixture-no-files/order-uploads/42/photo.webp", mime: "image/webp", fileName: "photo.webp" }),
  sanitizeOriginalName: () => "photo.png", uploadErrorHandler: (error, _req, _res, next) => next(error),
});
mockModule("../middleware/rateLimit", {
  orderCreateRateLimit: (_req, _res, next) => next(), orderMutationRateLimit: (_req, _res, next) => next(),
  orderReadRateLimit: (_req, _res, next) => next(), paymentLinkRateLimit: (_req, _res, next) => next(),
  paymentCallbackRateLimit: (_req, _res, next) => next(),
});
mockModule("../telegram", {});
mockModule("../lib/paykeeper", { createInvoice: async (input) => { calls.invoices.push(input); return {}; } });
const orderRoutes = require("../routes/orderRoutes");
const paymentRoutes = require("../routes/payments.paykeeper");

beforeEach(() => Object.values(calls).forEach((items) => { items.length = 0; }));
const openApp = async (t) => {
  const previous = process.env.ORDER_ACCESS_SECRET;
  process.env.ORDER_ACCESS_SECRET = "fixture-order-delivery-secret-".repeat(3);
  const app = express();
  app.use(express.json());
  app.use("/orders", orderRoutes);
  app.use("/payment", paymentRoutes);
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(async () => {
    if (previous === undefined) delete process.env.ORDER_ACCESS_SECRET; else process.env.ORDER_ACCESS_SECRET = previous;
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
};
const createBody = (overrides) => {
  const body = new FormData();
  for (const [name, value] of Object.entries({ firstName: "Иван", lastName: "Иванов", phone: "+79991234567", privacyConsent: "true",
    productType: "Худи", color: "Чёрный", size: "M", embroideryType: "Car", carDesign: "medium", patronusCount: "1", petFaceCount: "1",
    deliveryCityToken: issueCitySelection({ id: "cdek:278", name: "Красноярск", label: "г Красноярск", longitude: 92.868, latitude: 56.0106, pickup: true }).token,
    deliveryMethod: "russian_post", deliveryAddress: "660075, Красноярск, ул. Маерчака, 5", ...overrides })) body.append(name, value);
  body.append("images", new Blob(["fixture bytes; decoding is tested separately"], { type: "image/png" }), "photo.png");
  return body;
};

for (const method of ["pickup"]) test(`${method} creates an unpaid saved request without a CDEK shipment or invoice`, async (t) => {
  const url = await openApp(t);
  const response = await fetch(url + "/orders/create", { method: "POST", body: createBody({ deliveryMethod: method }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.orderId, 42);
  assert.ok(data.orderToken);
  assert.equal(data.pricePending, true);
  assert.equal(data.requiresBankPayment, false);
  assert.equal(data.totalPrice, null);
  assert.equal(data.paymentAmount, null);
  assert.equal(data.deliveryMode, method);
  assert.equal(calls.orders.length, 1);
  assert.equal(calls.orders[0].orderValues.status, "Ожидает расчёта");
  assert.equal(calls.orders[0].orderValues.paymentStatus, "manual");
  assert.equal(calls.orders[0].orderValues.recipientPhone, "+79991234567");
  assert.equal(calls.orders[0].shipmentValues, null);
  assert.equal(calls.cdekQuotes.length, 0);
  assert.equal(calls.attachments.length, 1);
  if (method === "pickup") {
    assert.equal(calls.orders[0].orderValues.deliveryAddress, "Самовывоз, Красноярск, ул. Ломоносова, 11");
    assert.equal(calls.orders[0].orderValues.deliveryCity, "Красноярск");
  } else assert.equal(calls.orders[0].orderValues.deliveryAddress, "Почта России, 660075, Красноярск, ул. Маерчака, 5");
  const payment = await fetch(url + "/payment/link", { method: "POST", headers: { "Content-Type": "application/json", "X-Order-Access-Token": data.orderToken }, body: JSON.stringify({ orderId: 42 }) });
  assert.equal(payment.status, 409);
  assert.equal(calls.invoices.length, 0);
});

test("CDEK delivery still calculates the server total and prepares only its own shipment", async (t) => {
  const url = await openApp(t);
  const response = await fetch(url + "/orders/create", { method: "POST", body: createBody({ deliveryMethod: "cdek", cdekMode: "office", cdekAddress: '{"code":"KRS1"}' }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pricePending, false);
  assert.equal(data.totalPrice, 9242);
  assert.equal(data.deliveryMode, "cdek_pvz");
  assert.equal(calls.cdekQuotes.length, 1);
  assert.equal(calls.orders[0].shipmentValues.provider, "cdek");
  assert.equal(calls.orders[0].orderValues.deliveryAddress, "СДЭК, KRS1, Мира, 1, до ПВЗ");
});

test("pickup cannot apply a certificate and postal orders cannot mix in stale CDEK data", async (t) => {
  const url = await openApp(t);
  for (const overrides of [
    { deliveryMethod: "pickup", certificateCode: "ITS" + "A1".repeat(16) },
    { cdekMode: "office", cdekAddress: '{"code":"KRS1"}' },
  ]) {
    const response = await fetch(url + "/orders/create", { method: "POST", body: createBody(overrides) });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.orders.length, 0);
  assert.equal(calls.cdekQuotes.length, 0);
});

test("Russian Post charges only merchandise online and never creates a CDEK shipment", async (t) => {
  const url = await openApp(t);
  const response = await fetch(url + "/orders/create", { method: "POST", body: createBody({ deliveryMethod: "russian_post" }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pricePending, false);
  assert.equal(data.requiresBankPayment, true);
  assert.equal(data.totalPrice, 8500);
  assert.equal(data.deliveryPrice, null);
  assert.equal(data.deliveryPayLater, true);
  assert.equal(data.deliveryMode, "russian_post");
  assert.equal(calls.orders[0].orderValues.deliveryAmountKopecks, 0);
  assert.equal(calls.orders[0].orderValues.merchandiseAmountKopecks, 850000);
  assert.equal(calls.orders[0].orderValues.paymentStatus, "pending");
  assert.equal(calls.orders[0].orderValues.deliveryAddress, "Почта России, 660075, Красноярск, ул. Маерчака, 5");
  assert.equal(calls.orders[0].shipmentValues, null);
  assert.equal(calls.cdekQuotes.length, 0);
  assert.equal(calls.invoices.length, 0);
});

test("an unpriced custom embroidery with Russian Post remains an unpaid request", async (t) => {
  const url = await openApp(t);
  const response = await fetch(url + "/orders/create", { method: "POST", body: createBody({ embroideryType: "custom",
    customOption: JSON.stringify({ image: true, text: false }), deliveryMethod: "russian_post" }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pricePending, true);
  assert.equal(data.requiresBankPayment, false);
  assert.equal(data.totalPrice, null);
  assert.equal(calls.orders[0].shipmentValues, null);
  assert.equal(calls.cdekQuotes.length, 0);
});

test("custom CDEK request saves the server office city without trusting a supplied city or calculating a tariff", async (t) => {
  const url = await openApp(t);
  const response = await fetch(url + "/orders/create", { method: "POST", body: createBody({
    embroideryType: "custom", customOption: JSON.stringify({ image: true, text: false }),
    deliveryMethod: "cdek", cdekMode: "office", cdekAddress: JSON.stringify({ code: "KRS1", city: "Подменённый город" }),
    deliveryCity: "Неверный город", deliveryAddress: "Неверный адрес",
  }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pricePending, true);
  assert.equal(data.deliveryCity, "Красноярск");
  assert.equal(calls.orders[0].orderValues.deliveryCity, "Красноярск");
  assert.equal(calls.orders[0].orderValues.deliveryAddress, "СДЭК, KRS1, Мира, 1, до ПВЗ");
  assert.equal(calls.orders[0].shipmentValues, null);
  assert.deepEqual(calls.offices, [{ code: "KRS1" }]);
  assert.equal(calls.cdekQuotes.length, 0);
  assert.equal(calls.invoices.length, 0);
});
