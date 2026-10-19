const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteCartItems } = require("../services/cartPricing");
const { calculateMerchandisePrice } = require("../services/orderPricing");

const inventory = { id: 10, quantity: 6, clothingType: { code: "hoodie", patronusLimit: 4, patronusPrice: 6000, carPrice: 7000, carSimplePrice: 7000, petFacePrice: 6000 } };
const item = (changes = {}) => ({ inventoryId: 10, productType: "Худи", color: "Чёрный", size: "M",
  quantity: 1, embroideryType: "Patronus", patronusCount: 1, petFaceCount: 1, ...changes });
const deps = (changes = {}) => ({ findInventory: async () => inventory, calculatePrice: calculateMerchandisePrice,
  getPricingExtras: async () => ({ Patronus: 1000, petFace: 500 }), ...changes });

test("cart estimate uses server prices and sums independent configurations and quantities", async () => {
  const result = await quoteCartItems([item({ patronusCount: 4, quantity: 2 }), item({ embroideryType: "petFace", petFaceCount: 5 }), item({ embroideryType: "Car", carDesign: "simple" })], deps());
  assert.deepEqual(result.items.map((entry) => entry.unitPrice), [9000, 8000, 7000]);
  assert.equal(result.merchandisePrice, 33000);
  assert.equal(inventory.quantity, 6);
});
test("missing or changed catalog entries keep rows removable, but hide incomplete total", async () => {
  const result = await quoteCartItems([item()], deps({ findInventory: async () => ({ ...inventory, id: 11 }) }));
  assert.equal(result.merchandisePrice, null);
  assert.match(result.items[0].pricingError, /недоступно/);
});
test("changed limits and unavailable prices produce Russian per-line errors", async () => {
  for (const changed of [item({ patronusCount: 5 }), item({ embroideryType: "custom" })]) {
    const result = await quoteCartItems([changed], deps());
    assert.equal(result.merchandisePrice, null);
    assert.ok(result.items[0].pricingError);
  }
});
test("stock warning includes other rows for the same inventory without reserving anything", async () => {
  const result = await quoteCartItems([item({ quantity: 5 }), item({ quantity: 2 })], deps());
  assert.ok(result.items.every((entry) => entry.stockWarning));
  assert.equal(inventory.quantity, 6);
});
test("unexpected failures are not disguised as a valid price; empty cart needs no pricing call", async () => {
  await assert.rejects(quoteCartItems([item()], deps({ calculatePrice: () => { throw new Error("Database unavailable"); } })), /Database unavailable/);
  assert.deepEqual(await quoteCartItems([], {}), { items: [], merchandisePrice: 0 });
});
