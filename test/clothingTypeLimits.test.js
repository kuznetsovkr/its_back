const assert = require("node:assert/strict");
const { test } = require("node:test");
const { serializeClothingType } = require("../services/clothingTypes");

test("legacy clothing profiles expose the new four-patronus maximum", () => {
  const serialized = serializeClothingType({
    id: 1,
    name: "Худи",
    code: "hoodie",
    patronusLimit: 5,
    patronusPrice: 10000,
    carPrice: 8500,
    petFacePrice: 8000,
  });
  assert.equal(serialized.patronusLimit, 4);
  assert.equal(serializeClothingType({ patronusLimit: 1 }).patronusLimit, 1);
});
