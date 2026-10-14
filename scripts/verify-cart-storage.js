const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!/^its_migration_test_\d+_\d+$/.test(process.env.DB_NAME || "")) throw new Error("Cart checks require an isolated migration-test database");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "its-cart-test-"));
process.env.UPLOAD_DIR = temporaryRoot;
const sharp = require("sharp");
const express = require("express");
const sequelize = require("../db");
const Cart = require("../models/Cart");
const CartItem = require("../models/CartItem");
const CartAttachment = require("../models/CartAttachment");
const Inventory = require("../models/Inventory");
const Order = require("../models/Order");
const InventoryReservation = require("../models/InventoryReservation");
const ClothingType = require("../models/ClothingType");
const { createCartService, CART_UPLOAD_DIR } = require("../services/carts");
const { validateImageFile } = require("../lib/uploadSecurity");
const { validateCartItem, CART_RETENTION_MS, CartError } = require("../lib/cartRules");
const { createCartRouter } = require("../routes/cartRoutes");
let now = new Date("2030-01-01T12:00:00Z");
let tokenIndex = 0;
const challenge = () => `cart-fixture-challenge-${++tokenIndex}`;
const usedTokens = new Set();
const verifyTurnstile = async ({ token }) => {
  if (!token?.startsWith("cart-fixture-challenge-") || usedTokens.has(token)) throw new CartError("Не пройдена защита от ботов", "fixture_challenge_failed", 403);
  usedTokens.add(token);
};
const service = createCartService({ now: () => now, verifyTurnstile });
const accessOf = (session) => ({ cartId: session.id, token: session.token });
let server;
let fixturePng;
const files = async (count = 1) => Promise.all(Array.from({ length: count }, async (_value, position) => {
  const filePath = path.join(temporaryRoot, `${crypto.randomUUID()}.upload`);
  await fs.promises.writeFile(filePath, fixturePng);
  const file = { path: filePath, size: fixturePng.length, mimetype: "image/png", originalname: `pet-${position}.png` };
  file.validatedImage = await validateImageFile(file);
  return file;
}));
const input = (overrides = {}) => ({ productType: "Худи", color: "Черный", size: "M", embroideryType: "Patronus",
  patronusCount: "4", petFaceCount: "1", comment: "Сохранённая вышивка", privacyConsent: "true", turnstileToken: challenge(), ...overrides });
const add = async (session, requestKey, overrides = {}, uploader = service) => {
  const uploaded = await files();
  return uploader.addItem({ access: accessOf(session), input: validateCartItem(input(overrides), uploaded), files: uploaded, requestKey });
};

const run = async () => {
  await sequelize.authenticate();
  fixturePng = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#bc5823" } }).png().toBuffer();
  const type = await ClothingType.findOne({ where: { code: "hoodie" } });
  const inventory = await Inventory.create({ productType: "Худи", color: "Черный", size: "M", clothingTypeId: type.id, quantity: 12 });
  const previousOrders = await Order.count();
  const previousReservations = await InventoryReservation.count();
  const previousCarts = await Cart.count();
  await assert.rejects(service.createSession({ turnstileToken: "invalid" }), { statusCode: 403 });
  assert.equal(await Cart.count(), previousCarts);
  const session = await service.createSession({ turnstileToken: challenge() });
  const access = accessOf(session);
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.equal(new Date(session.expiresAt) - now, CART_RETENTION_MS);
  const stored = await Cart.findByPk(session.id);
  assert.notEqual(stored.accessTokenHash, session.token);
  assert.equal(stored.accessTokenHash.length, 64);
  await assert.rejects(service.getCart({ ...access, token: "a".repeat(64) }), { statusCode: 404 });

  const key = crypto.randomUUID();
  const [saved, repeated] = await Promise.all([add(session, key), add(session, key)]);
  assert.equal(saved.addedItemId, repeated.addedItemId);
  assert.deepEqual([saved.alreadyAdded, repeated.alreadyAdded].sort(), [false, true], "exactly one concurrent request creates the item");
  assert.equal(await CartItem.count({ where: { cartId: session.id } }), 1);
  assert.equal(usedTokens.size, 1, "one initial CAPTCHA covers session creation and its first upload, not duplicates");
  await assert.rejects(add(session, key, { comment: "Другая вышивка" }), { code: "cart_request_conflict" });
  await assert.rejects(add(session, crypto.randomUUID(), { turnstileToken: "invalid" }), { statusCode: 403 });
  const second = await add(session, crypto.randomUUID(), { embroideryType: "Car", comment: "Другое изделие" });
  assert.equal(second.items.length, 2);
  assert.equal(usedTokens.size, 2);
  const restored = await createCartService({ now: () => now, verifyTurnstile }).getCart(access);
  assert.equal(restored.items.length, 2);
  assert.deepEqual(restored.items.map((item) => item.comment), ["Сохранённая вышивка", "Другое изделие"]);
  assert.equal(JSON.stringify(restored).includes("accessTokenHash"), false);
  assert.equal(JSON.stringify(restored).includes("requestHash"), false);
  assert.equal(JSON.stringify(restored).includes(temporaryRoot), false);
  const first = restored.items[0];
  assert.equal(first.requestKey, key);
  assert.equal(restored.merchandisePrice, restored.items.reduce((sum, item) => sum + item.linePrice, 0));
  assert.ok(first.unitPrice > 0);
  const image = await service.getAttachment(access, first.id, first.attachments[0].id);
  assert.deepEqual(await fs.promises.readFile(image.filePath), fixturePng);
  await assert.rejects(service.getAttachment(access, restored.items[1].id, first.attachments[0].id), { statusCode: 404 });
  const other = await service.createSession({ turnstileToken: challenge() });
  await assert.rejects(service.getAttachment(accessOf(other), first.id, first.attachments[0].id), { statusCode: 404 });
  const increased = await service.setQuantity(access, first.id, 3);
  assert.equal(increased.items[0].linePrice, first.unitPrice * 3);
  await assert.rejects(service.setQuantity(access, first.id, 20), { code: "cart_stock_unavailable" });
  await assert.rejects(service.setQuantity(access, first.id, 21), { statusCode: 400 });
  assert.equal((await inventory.reload()).quantity, 12);
  assert.equal(await Order.count(), previousOrders);
  assert.equal(await InventoryReservation.count(), previousReservations);
  await inventory.update({ quantity: 0 });
  await service.setQuantity(access, first.id, 1);
  await inventory.update({ quantity: 12 });

  // Actual HTTP router: origin, access, strict DTO, file signature and owner-only download.
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_APP_URL = "https://cart-fixture.example";
  process.env.ALLOWED_PUBLIC_ORIGINS = "https://cart-fixture.example";
  const app = express();
  app.use(express.json());
  app.use("/api/cart", createCartRouter(service));
  server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}/api/cart`;
  const headers = { Origin: "https://cart-fixture.example", "X-Cart-Access-Token": session.token };
  assert.equal((await fetch(`${base}/${session.id}`)).status, 401);
  assert.equal((await fetch(`${base}/${session.id}`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/${session.id}`, { headers: { ...headers, "X-Cart-Access-Token": other.token } })).status, 404);
  assert.equal((await fetch(`${base}/${session.id}/items/${first.id}`, { method: "PATCH", headers: { ...headers, Origin: "https://evil.example", "Content-Type": "application/json" }, body: '{"quantity":1}' })).status, 403);
  assert.equal((await fetch(`${base}/${session.id}/items/${first.id}`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: '{"quantity":1,"price":1}' })).status, 400);
  const picture = await fetch(`http://127.0.0.1:${server.address().port}${first.attachments[0].downloadUrl}`, { headers });
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get("cache-control"), "private, no-store");
  assert.equal(picture.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await picture.arrayBuffer()), fixturePng);
  const multipart = (payload = input(), content = fixturePng) => {
    const form = new FormData();
    for (const [field, value] of Object.entries(payload)) form.append(field, value);
    form.append("images", new Blob([content], { type: "image/png" }), "photo.png");
    return form;
  };
  const postImage = (payload, content) => fetch(`${base}/${other.id}/items`, { method: "POST",
    headers: { Origin: headers.Origin, "X-Cart-Access-Token": other.token, "Idempotency-Key": crypto.randomUUID() }, body: multipart(payload, content) });
  assert.equal((await postImage(input(), Buffer.from("not an image"))).status, 415);
  assert.equal((await postImage(input({ price: "1" }))).status, 400);
  const validHttp = await postImage(input({ embroideryType: "petFace", petFaceCount: "5", comment: "HTTP-фотография" }));
  assert.equal(validHttp.status, 201);
  const protectedOtherItem = (await validHttp.json()).items[0];
  const protectedOtherPhoto = await service.getAttachment(accessOf(other), protectedOtherItem.id, protectedOtherItem.attachments[0].id);
  await new Promise((resolve) => server.close(resolve));
  server = null;
  process.env.NODE_ENV = "test";

  // A failed second file rolls back DB records and all files already moved.
  const failingSession = await service.createSession({ turnstileToken: challenge() });
  let creates = 0;
  const failing = createCartService({ now: () => now, verifyTurnstile, CartAttachment: {
    findAll: CartAttachment.findAll.bind(CartAttachment), findOne: CartAttachment.findOne.bind(CartAttachment),
    create: (...args) => { if (++creates === 2) throw new Error("fixture DB failure"); return CartAttachment.create(...args); },
  } });
  const multipleFiles = await files(2);
  await assert.rejects(failing.addItem({ access: accessOf(failingSession), input: validateCartItem(input(), multipleFiles), files: multipleFiles, requestKey: crypto.randomUUID() }), /fixture DB failure/);
  assert.equal(await CartItem.count({ where: { cartId: failingSession.id } }), 0);
  for (const entry of await fs.promises.readdir(path.join(CART_UPLOAD_DIR, failingSession.id))) {
    assert.equal((await fs.promises.readdir(path.join(CART_UPLOAD_DIR, failingSession.id, entry))).length, 0);
  }
  await service.clearCart(accessOf(failingSession));

  await service.removeItem(access, first.id);
  await assert.rejects(fs.promises.stat(image.filePath), { code: "ENOENT" });
  await assert.rejects(service.getAttachment(access, first.id, first.attachments[0].id), { statusCode: 404 });
  await assert.rejects(add(session, key), { code: "cart_item_removed" });
  assert.ok((await CartItem.findByPk(first.id)).filesPurgedAt);
  now = new Date(now.getTime() + 2 * 24 * 60 * 60_000);
  const touched = await service.setQuantity(access, restored.items[1].id, 2);
  assert.equal(new Date(touched.expiresAt) - now, CART_RETENTION_MS);
  now = new Date(now.getTime() + 60_000);
  assert.equal((await service.setQuantity(access, restored.items[1].id, 2)).expiresAt, touched.expiresAt, "unchanged quantity does not extend retention");
  assert.equal((await service.removeItem(access, first.id)).expiresAt, touched.expiresAt, "repeating deletion does not extend retention");
  await service.setQuantity(accessOf(other), protectedOtherItem.id, 1);
  const externalFile = path.join(temporaryRoot, "unrelated.png");
  await fs.promises.writeFile(externalFile, fixturePng);
  const orphanDirectory = path.join(CART_UPLOAD_DIR, session.id, crypto.randomUUID());
  await fs.promises.mkdir(orphanDirectory, { recursive: true });
  await fs.promises.writeFile(path.join(orphanDirectory, `${crypto.randomUUID()}.png`), fixturePng);
  now = new Date(now.getTime() + CART_RETENTION_MS);
  await assert.rejects(service.getCart(access), { code: "cart_expired" });
  await assert.rejects(service.getAttachment(access, restored.items[1].id, restored.items[1].attachments[0].id), { statusCode: 410 });
  // Keep the second cart active while expiring the first.
  await Cart.update({ expiresAt: new Date(now.getTime() + CART_RETENTION_MS) }, { where: { id: other.id } });
  await service.cleanUp();
  assert.equal(await Cart.findByPk(session.id), null);
  await assert.rejects(fs.promises.stat(path.join(CART_UPLOAD_DIR, session.id)), { code: "ENOENT" });
  assert.deepEqual(await fs.promises.readFile(externalFile), fixturePng);
  assert.deepEqual(await fs.promises.readFile(protectedOtherPhoto.filePath), fixturePng);
  await service.clearCart(accessOf(other));
  assert.equal(await Cart.findByPk(other.id), null);
  console.log("[cart-test] Persistent items/photos, ownership, CAPTCHA, idempotency, atomic rollback, quantity and 30-day cleanup verified");
};

run().catch((error) => { console.error("[cart-test] Failed:", error.message); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await sequelize.close();
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("its-cart-test-")) throw new Error("Unsafe test cleanup target");
  await fs.promises.rm(resolved, { recursive: true, force: true });
});
