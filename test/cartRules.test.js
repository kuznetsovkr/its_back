const assert = require("node:assert/strict");
const { test } = require("node:test");
const { CART_RETENTION_MS, assertCartCapacity, readUuid, validateCartItem, validateCartQuantity } = require("../lib/cartRules");
const { tokenHash, attachmentPath } = require("../services/carts");
const uuid = "4b7bb03c-15f3-4f71-846e-26ca601fa246";
const body = { productType: "Худи", color: "Черный", size: "M", embroideryType: "Patronus", patronusCount: "4", petFaceCount: "1", comment: "Каждому изделию своё фото", privacyConsent: "true" };
const files = Array.from({ length: 4 }, () => ({}));

test("cart validates the shared four-patronus/five-pet-face limits, not garment quantity", () => {
  assert.equal(validateCartItem(body, files).patronusCount, 4);
  assert.throws(() => validateCartItem({ ...body, patronusCount: "5" }, files), /не более 4/);
  assert.equal(validateCartItem({ ...body, embroideryType: "petFace", petFaceCount: "5" }, files).petFaceCount, 5);
  assert.throws(() => validateCartItem({ ...body, embroideryType: "petFace", petFaceCount: "6" }, files), /не более 5/);
  assert.throws(() => validateCartItem({ ...body, embroideryType: "petFace" }, Array(6).fill({})), /до 5 фотографий/);
});
test("cart accepts only complete supported items and never client prices/contact data", () => {
  for (const field of ["price", "quantity", "inventoryId", "imageUrl", "email", "certificateCode"]) {
    assert.throws(() => validateCartItem({ ...body, [field]: "1" }, files), /Неизвестные поля/);
  }
  assert.throws(() => validateCartItem({ ...body, embroideryType: "custom" }, files), /отдельной заявкой/);
  assert.throws(() => validateCartItem({ ...body, size: "" }, files), /size/);
  assert.throws(() => validateCartItem(body, []), /Загрузите/);
  assert.throws(() => validateCartItem({ ...body, privacyConsent: "false" }, files), /согласие/);
  assert.throws(() => validateCartItem(body, Array(11).fill({})), /до 10 фотографий/);
});
test("cart quantity, active-item and storage caps are bounded independently", () => {
  assert.equal(validateCartQuantity({ quantity: 20 }), 20);
  for (const quantity of [0, -1, 1.5, 21, "1e2", true]) assert.throws(() => validateCartQuantity({ quantity }));
  assert.throws(() => validateCartQuantity({ quantity: 1, price: 0 }), /Неизвестные поля/);
  assertCartCapacity({ items: [{ quantity: 50, deletedAt: new Date() }], bytes: 0, addedQuantity: 1 });
  assert.throws(() => assertCartCapacity({ items: Array(20).fill({ quantity: 1 }), bytes: 0, addedItems: 1 }), /20 разных/);
  assert.throws(() => assertCartCapacity({ items: [{ quantity: 50 }], bytes: 0, addedQuantity: 1 }), /50 изделий/);
  assert.throws(() => assertCartCapacity({ items: [], bytes: 50 * 1024 * 1024, addedBytes: 1 }), /50 МБ/);
  assert.equal(CART_RETENTION_MS, 30 * 24 * 60 * 60_000);
});
test("cart identity and attachment paths cannot escape the private store", () => {
  assert.equal(readUuid(uuid.toUpperCase()), uuid);
  for (const id of ["../orders", "1", uuid + "/../", null]) assert.throws(() => readUuid(id));
  assert.throws(() => attachmentPath(uuid, uuid, "../other.jpg"));
  assert.match(attachmentPath(uuid, uuid, "picture.jpg"), /picture\.jpg$/);
  assert.match(tokenHash("private-capability"), /^[a-f0-9]{64}$/);
});
