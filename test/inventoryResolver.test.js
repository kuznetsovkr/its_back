const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const calls = [];
let results = [];
const Inventory = {
  findOne: async (options) => {
    calls.push(options);
    return results.shift() ?? null;
  },
};

mockModule("../models/Inventory", Inventory);
mockModule("../models/ClothingType", {});
const { findInventoryForOrder } = require("../services/inventoryResolver");

beforeEach(() => {
  calls.length = 0;
  results = [];
});

test("inventory lookup supports only exact product types without lining aliases", async () => {
  results = [null, null];

  const item = await findInventoryForOrder("Худи (с начёсом)", "Чёрный", "M");

  assert.equal(item, null);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].where, {
    productType: "Худи (с начёсом)",
    color: "Чёрный",
    size: "M",
  });
});

test("inventory lookup retains a case-insensitive fallback", async () => {
  const expected = { id: 12, productType: "Худи" };
  results = [null, expected];

  const item = await findInventoryForOrder("худи", "чёрный", "L");

  assert.equal(item, expected);
  assert.equal(calls.length, 2);
});
