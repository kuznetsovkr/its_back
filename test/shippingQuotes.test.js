const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const axios = require("axios");
const { combineShippingPackages } = require("../lib/shippingPackages");
const { issueCdekQuoteContext, verifyCdekQuoteContext } = require("../lib/cdekQuoteContext");
const { buildCdekCalculatePayload } = require("../lib/cdekRequestValidation");
const oldSecret = process.env.ORDER_ACCESS_SECRET;
process.env.ORDER_ACCESS_SECRET = "shipping-context-test-secret";
after(() => { if (oldSecret === undefined) delete process.env.ORDER_ACCESS_SECRET; else process.env.ORDER_ACCESS_SECRET = oldSecret; });
const mock = (name, exports) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
const catalog = (productType) => ({ productType, quantity: 50, clothingType: { code: productType === "Футболка" ? "tshirt" : "hoodie",
  carSimplePrice: productType === "Футболка" ? 5000 : 6500, carMediumPrice: 8500, carComplexPrice: 11500,
  patronusPrice: 10000, petFacePrice: 8000, patronusLimit: 4,
  packageLength: productType === "Футболка" ? 30 : 35, packageWidth: productType === "Футболка" ? 25 : 35,
  packageHeight: productType === "Футболка" ? 3 : 7, packageWeight: productType === "Футболка" ? 300 : 800 } });
mock("../services/inventoryResolver", { findInventoryForOrder: async name => name === "нет" ? null : catalog(name) });
mock("../services/pricingConfig", { getPricingExtras: async () => ({ Patronus: 5000, petFace: 2000 }) });
const { createShippingQuoteContext } = require("../services/shippingQuoteContext");
const item = (name = "Худи", quantity = 1) => ({ productType: name, color: "Чёрный", size: "M", embroideryType: "Car", carDesign: "simple", quantity });

test("one bag uses maximum base, summed heights and grams, including mixed quantities", () => {
  assert.deepEqual(combineShippingPackages([{ length: 35, width: 35, height: 7, weight: 800 }, { length: 30, width: 25, height: 3, weight: 300 }]),
    [{ number: "1", length: 35, width: 35, height: 10, weight: 1100 }]);
  for (const invalid of [[], Array(51).fill({}), [{ length: 35, width: 35, height: 0, weight: 800 }]]) assert.throws(() => combineShippingPackages(invalid));
});
test("signed widget quote uses server catalog prices and a single bag, not browser financial fields", async () => {
  const quote = await createShippingQuoteContext({ items: [item("Худи", 2), item("Футболка")] });
  assert.deepEqual(quote.packages, [{ number: "1", length: 35, width: 35, height: 17, weight: 1900 }]);
  assert.equal(verifyCdekQuoteContext(quote.token).declaredValue, 18000);
  assert.equal(quote.pricePending, false);
  for (const body of [{ items: [item()], declaredValue: 1 }, { items: [{ ...item(), price: 1 }] }, { items: [item("нет")] },
    { items: [item("Худи", 20), item("Худи", 20), item("Худи", 20)] }, { items: [{ ...item("Футболка"), carDesign: "complex" }] }]) await assert.rejects(createShippingQuoteContext(body));
});
test("unknown custom price stays unknown; custom designs cannot be mixed with payable items", async () => {
  const custom = { ...item(), embroideryType: "custom", carDesign: undefined };
  const quote = await createShippingQuoteContext({ items: [custom] });
  assert.equal(quote.pricePending, true); assert.equal(verifyCdekQuoteContext(quote.token).declaredValue, null);
  await assert.rejects(createShippingQuoteContext({ items: [custom, item()] }));
});
test("widget context expires, rejects tampering and overrides any untrusted browser dimensions/origin", () => {
  const packages = [{ number: "1", length: 35, width: 35, height: 10, weight: 1100 }];
  const token = issueCdekQuoteContext({ packages, declaredValue: 11500 }, 1000);
  assert.equal(verifyCdekQuoteContext(token, 1001).declaredValue, 11500);
  assert.throws(() => verifyCdekQuoteContext(token, 1000 + 30 * 60_000));
  assert.throws(() => verifyCdekQuoteContext(token.replace("cq1", "city1"), 1001));
  const [version, body, signature] = token.split(".");
  assert.throws(() => verifyCdekQuoteContext(`${version}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), declaredValue: 1 })).toString("base64url")}.${signature}`, 1001));
  const fresh = issueCdekQuoteContext({ packages, declaredValue: 11500 });
  const payload = buildCdekCalculatePayload({ action: "calculate", to_location: { code: 44 }, packages: [{ weight: 0.001 }], from_location: { code: 1 } }, [], fresh);
  assert.deepEqual(payload.packages, packages); assert.equal(payload.declaredValue, 11500);
  assert.equal(payload.from_location, undefined);
});
test("public shipping endpoints share the insured total and reject old/forged widget requests", async t => {
  const express = require("express"); const app = express(); app.use(express.json());
  app.use("/pricing", require("../routes/pricingRoutes")); app.use(require("../routes/cdekServiceRoutes"));
  const get = axios.get; const post = axios.post;
  const previousId = process.env.CDEK_CLIENT_ID; const previousSecret = process.env.CDEK_CLIENT_SECRET;
  process.env.CDEK_CLIENT_ID = "test-client"; process.env.CDEK_CLIENT_SECRET = "test-secret";
  axios.get = async () => ({ data: [] });
  axios.post = async (url, body) => {
    if (url.endsWith("/oauth/token")) return { data: { access_token: "fixture", expires_in: 3600 } };
    assert.ok(url.endsWith("/calculator/tariff"));
    assert.deepEqual(body.services, [{ code: "INSURANCE", parameter: "11500" }]);
    assert.deepEqual(body.packages, [{ number: "1", length: 35, width: 35, height: 10, weight: 1100 }]);
    assert.equal(body.from_location.code, 278); assert.equal(body.delivery_recipient_cost, undefined);
    return { data: { delivery_sum: 380, total_sum: 477.75, services: [{ code: "INSURANCE", total_sum: 78.75 }] } };
  };
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => { axios.get = get; axios.post = post;
    if (previousId === undefined) delete process.env.CDEK_CLIENT_ID; else process.env.CDEK_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.CDEK_CLIENT_SECRET; else process.env.CDEK_CLIENT_SECRET = previousSecret;
    await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const quote = await fetch(base + "/pricing/shipping-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [item(), item("Футболка")] }) });
  assert.equal(quote.status, 200); const context = await quote.json();
  const calculate = suffix => fetch(base + "/service.php" + suffix, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "calculate", to_location: { code: 44 }, packages: [] }) });
  const response = await calculate("?shippingContext=" + encodeURIComponent(context.token));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.tariff_codes[0].delivery_sum, 477.75); assert.equal(result.tariff_codes[0].total_sum, 477.75);
  assert.equal((await calculate("")).status, 400); assert.equal((await calculate("?shippingContext=forged")).status, 400);
  assert.equal((await fetch(base + "/service.php?action=offices&shippingContext=" + encodeURIComponent(context.token))).status, 200);
});
