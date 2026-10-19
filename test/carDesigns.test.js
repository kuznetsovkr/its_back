const assert = require("node:assert/strict");
const { test } = require("node:test");
const { calculateMerchandisePrice, PricingError } = require("../services/orderPricing");
const { getCarDesignPrices, getCarEmbroideryLabel } = require("../lib/carDesigns");
const { readCarDesign, validateOrderCreateInput } = require("../lib/requestValidation");
const { validateCartItem } = require("../lib/cartRules");
const { quoteCartItems } = require("../services/cartPricing");
const configurations = [
  ["tshirt", 5000, 7000, null], ["svitshot", 6000, 8000, 11000], ["hoodie", 6500, 8500, 11500],
];
for (const [code, simple, medium, complex] of configurations) {
  const clothingType = { code, carSimplePrice: simple, carMediumPrice: medium, carComplexPrice: complex, carPrice: 1 };
  for (const [carDesign, expected] of Object.entries({ simple, medium, complex })) {
    test(`${code}/${carDesign}: uses the approved finished-product price, never the legacy price`, () => {
      const run = () => calculateMerchandisePrice({ inventory: { clothingType }, embroideryType: "Car", carDesign });
      if (expected == null) assert.throws(run, (error) => error.code === "car_design_unavailable");
      else assert.equal(run().merchandisePrice, expected);
    });
  }
}
test("a direct request cannot order a complex T-shirt even if its price was misconfigured", () => {
  assert.equal(getCarDesignPrices({ code: "tshirt", carComplexPrice: 1 }).complex, null);
  assert.throws(() => calculateMerchandisePrice({ inventory: { clothingType: { code: "tshirt", carComplexPrice: 1 } }, embroideryType: "Car", carDesign: "complex" }), PricingError);
});
test("missing, forged and prototype car designs fail closed; other embroidery types have no car design", () => {
  for (const value of [undefined, "", "unknown", "__proto__", "constructor", 1]) assert.throws(() => readCarDesign(value, "Car"));
  assert.equal(readCarDesign("simple", "Patronus"), null);
  assert.match(getCarEmbroideryLabel("medium"), /средний дизайн \(23 см\)/);
  const body = { productType: "Худи", color: "Чёрный", size: "M", embroideryType: "Car", privacyConsent: "true" };
  assert.throws(() => validateCartItem(body, [{}]), /сложность дизайна/);
  const item = validateCartItem({ ...body, carDesign: "complex" }, [{}]);
  assert.equal(item.carDesign, "complex");
  assert.match(item.embroideryTypeRu, /сложный дизайн/);
});
test("a legacy unpaid car row is not silently mapped to a cheaper new design", async () => {
  const inventory = { id: 1, quantity: 3, clothingType: { code: "hoodie", carSimplePrice: 6500 } };
  const result = await quoteCartItems([{ id: 1, inventoryId: 1, embroideryType: "Car", quantity: 1 }], {
    findInventory: async () => inventory, getPricingExtras: async () => ({}), calculatePrice: calculateMerchandisePrice,
  });
  assert.equal(result.merchandisePrice, null);
  assert.match(result.items[0].pricingError, /Удалите это изделие и создайте заново/);
});
test("order DTO carries the selected design and its server-owned label", () => {
  const result = validateOrderCreateInput({ firstName: "Иван", lastName: "Иванов", phone: "+79991234567", productType: "Худи",
    color: "Чёрный", size: "M", embroideryType: "Car", carDesign: "medium", patronusCount: "1", petFaceCount: "1",
    privacyConsent: "true", deliveryAddress: "Адрес", embroideryTypeRu: "Подмена" }, [{}]);
  assert.equal(result.carDesign, "medium");
  assert.equal(result.embroideryTypeRu, getCarEmbroideryLabel("medium"));
});
