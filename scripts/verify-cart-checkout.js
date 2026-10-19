if (process.env.NODE_ENV !== "test" || !/^its_migration_test_\d+_\d+$/.test(process.env.DB_NAME || "")) throw new Error("Cart checkout verification requires an isolated migration-test database");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "its-cart-checkout-test-"));
process.env.UPLOAD_DIR = root;
process.env.ORDER_ACCESS_SECRET = crypto.randomBytes(32).toString("hex");
process.env.CERTIFICATE_CODE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.PAYKEEPER_TEST_MODE = "1";
process.env.ENABLE_CDEK_AUTO_SHIPMENT = "0";
const mock = (name, exports) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
const notified = [];
const notify = async (order, attachments) => { notified.push({ order, attachments }); };
notify.sendOrderIssueToTelegram = async () => 1;
mock("../telegram", notify);
mock("../services/lowStockMonitor", { checkItemAndNotify: async () => {} });
const invoices = [];
mock("../lib/paykeeper", { createInvoice: async (input) => {
  invoices.push(input); return { invoice_id: `fixture-${input.orderid}`, pay_url: `https://paykeeper.fixture.test/bill/${input.orderid}/` };
} });
const sharp = require("sharp");
const sequelize = require("../db");
const Cart = require("../models/Cart");
const CartItem = require("../models/CartItem");
const CartCheckout = require("../models/CartCheckout");
const ClothingType = require("../models/ClothingType");
const Inventory = require("../models/Inventory");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const Attachment = require("../models/OrderAttachment");
const Reservation = require("../models/InventoryReservation");
const Shipment = require("../models/OrderShipment");
const CertificateReservation = require("../models/GiftCertificateReservation");
const { createCartService } = require("../services/carts");
const { createCartCheckoutService } = require("../services/cartCheckout");
const { validateCartItem, CART_RETENTION_MS } = require("../lib/cartRules");
const { validateCartCheckout, validateCartQuote } = require("../lib/cartCheckoutRules");
const { issueCitySelection } = require("../lib/deliveryCity");
const { validateImageFile } = require("../lib/uploadSecurity");
const { finalizePaidOrder } = require("../services/orderFinalizer");
const { releaseExpiredReservations, assertActiveReservation } = require("../services/inventoryReservations");
const { createCertificatePurchase, activateCertificate, getCertificateCodeForDelivery } = require("../services/giftCertificates");
let now = new Date();
const verifyTurnstile = async ({ token }) => { if (token !== "fixture") throw Object.assign(new Error("Не пройдена проверка"), { statusCode: 403 }); };
mock("../services/turnstileVerification", { verifyTurnstileToken: verifyTurnstile, TurnstileVerificationError: class extends Error {} });
const carts = createCartService({ now: () => now, verifyTurnstile });
let deliveryPrice = 450;
const calculateDelivery = async ({ packages, cdekAddress }) => ({ deliveryPrice, tariffCode: 136, packages,
  office: { code: cdekAddress.code, location: { city: "Красноярск", address: "Мира, 1", city_code: 278 } } });
const checkout = createCartCheckoutService({ carts, verifyTurnstile, calculateDelivery });
const ids = [];
const inventories = [];
let imageBytes;
let certificateIndex = 0;
let server;
const buyer = { firstName: "Иван", lastName: "Иванов", middleName: "", phone: "+79991234567", email: "cart-fixture@example.com", privacyConsent: true,
  recipientFullName: "Петров Пётр", recipientPhoneDigits: "+79998887766", comment: "Весь заказ", deliveryComment: "Позвонить заранее" };
const newCart = async () => {
  const session = await carts.createSession({ turnstileToken: "fixture" }); ids.push(session.id);
  return { cartId: session.id, token: session.token };
};
const add = async (access, inventory, { embroideryType = "Car", comment = "Фото к изделию", quantity = 1 } = {}) => {
  const filePath = path.join(root, `${crypto.randomUUID()}.upload`);
  await fs.promises.writeFile(filePath, imageBytes);
  const file = { path: filePath, originalname: "pet.png", mimetype: "image/png", size: imageBytes.length };
  file.validatedImage = await validateImageFile(file);
  const raw = { productType: inventory.productType, color: inventory.color, size: inventory.size,
    embroideryType, carDesign: embroideryType === "Car" ? "simple" : "", patronusCount: "1", petFaceCount: "1", comment, privacyConsent: "true", turnstileToken: "fixture" };
  const saved = await carts.addItem({ access, input: validateCartItem(raw, [file]), files: [file], requestKey: crypto.randomUUID() });
  if (quantity > 1) await carts.setQuantity(access, saved.addedItemId, quantity);
  return saved.addedItemId;
};
const quote = async (access, certificateCode = "") => {
  const cart = await carts.getCart(access);
  return checkout.quote(access, { revision: cart.revision, officeCode: "KRS1", certificateCode });
};
const payload = (quoted, certificateCode = "") => validateCartCheckout({ revision: quoted.revision, officeCode: "KRS1", certificateCode,
  quoteHash: quoted.quoteHash, turnstileToken: "fixture", buyer });
const paid = (orderId, suffix = "paid") => finalizePaidOrder({ orderId, provider: "paykeeper", eventId: `cart-fixture-${suffix}-${orderId}`,
  paymentConfirmed: true, overrides: { paymentId: `cart-fixture-${orderId}` } });
const issue = async (denomination = 20000) => {
  const certificate = await createCertificatePurchase({ denomination, fullName: "Покупатель Тестовый", phone: "+79991234567", email: "cart@example.com", privacyConsent: true });
  await certificate.update({ paykeeperInvoiceId: `cart-fixture-invoice-${certificate.id}` });
  await activateCertificate({ certificateId: certificate.id, paymentId: `cart-fixture-cert-${++certificateIndex}`, amountKopecks: 100, paymentConfirmed: true });
  await certificate.reload();
  return { certificate, code: getCertificateCodeForDelivery(certificate) };
};

const run = async () => {
  imageBytes = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#bc5823" } }).png().toBuffer();
  for (const [code, name] of [["hoodie", "Худи"], ["tshirt", "Футболка"]]) {
    const type = await ClothingType.findOne({ where: { code } });
    inventories.push(await Inventory.create({ productType: name, color: "Тестовый", size: "M", quantity: 100, clothingTypeId: type.id }));
  }
  const [hoodie, shirt] = inventories;
  const access = await newCart();
  await add(access, hoodie, { quantity: 2 }); await add(access, hoodie, { embroideryType: "petFace", comment: "Другое фото" }); await add(access, shirt);
  const quoted = await quote(access);
  assert.equal(quoted.packages.length, 4, "one package for each unit, not just each embroidery configuration");
  const input = payload(quoted);
  const key = crypto.randomUUID();
  const [first, repeated] = await Promise.all([checkout.create(access, input, key), checkout.create(access, input, key)]);
  assert.equal(first.orderId, repeated.orderId);
  assert.equal(await CartCheckout.count({ where: { cartId: access.cartId } }), 1);
  assert.equal(first.items.length, 3);
  assert.ok(first.items.filter((item) => item.embroideryType === "Car").every((item) => item.carDesign === "simple"));
  assert.equal(await OrderItem.count({ where: { orderId: first.orderId } }), 3);
  assert.equal(first.buyer.recipientPhone, "+79998887766");
  assert.equal(first.paymentAmount, 1);
  assert.equal(first.totalPrice, quoted.totalPrice);
  assert.equal((await hoodie.reload()).quantity, 97);
  assert.equal((await shirt.reload()).quantity, 99);
  const reserves = await Reservation.findAll({ where: { orderId: first.orderId }, order: [["inventoryId", "ASC"]] });
  assert.deepEqual(reserves.map((row) => row.quantity).sort(), [1, 3]);
  assert.equal((await Shipment.findOne({ where: { orderId: first.orderId } })).packages.length, 4);
  await assert.rejects(carts.setQuantity(access, first.items[0].sourceCartItemId, 1), { code: "cart_checkout_locked" });
  const frozen = await carts.getCart(access);
  assert.equal(frozen.checkout.orderId, first.orderId);
  assert.equal(frozen.merchandisePrice, first.merchandisePrice);
  assert.ok(frozen.items.every((item) => !item.stockWarning));
  const copies = await Attachment.findAll({ where: { orderId: first.orderId }, raw: true });
  assert.equal(copies.length, 3);
  assert.equal(new Set(copies.map((file) => file.orderItemId)).size, 3);
  for (const file of copies) { assert.ok(file.path.startsWith(path.join(root, "orders"))); assert.deepEqual(await fs.promises.readFile(file.path), imageBytes); }
  await paid(first.orderId); await paid(first.orderId);
  assert.equal((await hoodie.reload()).quantity, 97, "payment does not reserve the same units twice");
  assert.equal((await carts.getCart(access)).items.length, 0);
  assert.equal(await CartItem.count({ where: { cartId: access.cartId, deletedAt: null } }), 0);
  assert.equal(notified.filter((event) => event.order.id === first.orderId).length, 1);
  assert.equal(notified.find((event) => event.order.id === first.orderId).order.items.length, 3);
  assert.equal((await Shipment.findOne({ where: { orderId: first.orderId } })).status, "awaiting_fulfillment");
  now = new Date(now.getTime() + CART_RETENTION_MS + 1);
  await carts.cleanUp();
  for (const file of copies) assert.deepEqual(await fs.promises.readFile(file.path), imageBytes, "cart retention must never delete order copies");
  now = new Date();

  const cert = await issue();
  const discountedCart = await newCart(); await add(discountedCart, shirt);
  const discountedQuote = await quote(discountedCart, cert.code);
  assert.equal(discountedQuote.certificateDiscount, discountedQuote.merchandisePrice);
  assert.equal(discountedQuote.amountDue, deliveryPrice, "certificate never covers delivery");
  const discounted = await checkout.create(discountedCart, payload(discountedQuote, cert.code), crypto.randomUUID());
  const balanceBefore = cert.certificate.balanceKopecks;
  await paid(discounted.orderId); await paid(discounted.orderId);
  assert.equal((await cert.certificate.reload()).balanceKopecks, balanceBefore - discountedQuote.certificateDiscount * 100);

  deliveryPrice = 0;
  const freeCart = await newCart(); await add(freeCart, shirt);
  const freeQuote = await quote(freeCart, cert.code);
  const free = await checkout.create(freeCart, payload(freeQuote, cert.code), crypto.randomUUID());
  assert.equal(free.amountDue, 0); assert.equal(free.requiresBankPayment, false);
  await finalizePaidOrder({ orderId: free.orderId, provider: "certificate", paymentConfirmed: true, eventId: `cart-free-${free.orderId}` });
  assert.equal((await Order.findByPk(free.orderId)).paymentStatus, "paid");
  deliveryPrice = 450;

  const cancelledCart = await newCart(); await add(cancelledCart, hoodie, { quantity: 2 }); await add(cancelledCart, shirt);
  const beforeCancel = [(await hoodie.reload()).quantity, (await shirt.reload()).quantity];
  const cancelQuote = await quote(cancelledCart);
  const cancelOrder = await checkout.create(cancelledCart, payload(cancelQuote), crypto.randomUUID());
  await checkout.cancel(cancelledCart); await checkout.cancel(cancelledCart);
  assert.deepEqual([(await hoodie.reload()).quantity, (await shirt.reload()).quantity], beforeCancel);
  assert.equal((await carts.getCart(cancelledCart)).items.length, 2);
  await assert.rejects(paid(cancelOrder.orderId), { code: "paid_cart_order_requires_review" });

  const expiredQuote = await quote(cancelledCart);
  const expired = await checkout.create(cancelledCart, payload(expiredQuote), crypto.randomUUID());
  await Reservation.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { orderId: expired.orderId } });
  await assert.rejects(assertActiveReservation(expired.orderId, null, true), { code: "reservation_expired" });
  await releaseExpiredReservations();
  assert.deepEqual([(await hoodie.reload()).quantity, (await shirt.reload()).quantity], beforeCancel);
  assert.equal((await Cart.findByPk(cancelledCart.cartId)).checkoutOrderId, null);

  const staleCart = await newCart(); const staleItem = await add(staleCart, hoodie);
  const staleQuote = await quote(staleCart);
  await carts.setQuantity(staleCart, staleItem, 2);
  await assert.rejects(checkout.create(staleCart, payload(staleQuote), crypto.randomUUID()), { code: "cart_changed" });
  const priceQuote = await quote(staleCart);
  const type = await ClothingType.findByPk(hoodie.clothingTypeId); const originalPrice = type.carSimplePrice;
  await type.update({ carSimplePrice: originalPrice + 100 });
  await assert.rejects(checkout.create(staleCart, payload(priceQuote), crypto.randomUUID()), { code: "cart_quote_changed" });
  await type.update({ carSimplePrice: originalPrice });

  const failCart = await newCart(); await add(failCart, hoodie); await add(failCart, shirt);
  const failQuote = await quote(failCart); const quantityBeforeFailure = (await hoodie.reload()).quantity;
  const countBefore = await Order.count(); let copied = 0;
  const failing = createCartCheckoutService({ carts, verifyTurnstile, calculateDelivery, copyFile: async (source, target) => {
    if (++copied === 2) throw new Error("fixture copy failure");
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  } });
  await assert.rejects(failing.create(failCart, payload(failQuote), crypto.randomUUID()), /fixture copy failure/);
  assert.equal(await Order.count(), countBefore);
  assert.equal((await hoodie.reload()).quantity, quantityBeforeFailure);
  assert.equal((await carts.getCart(failCart)).items.length, 2);

  // Concurrent baskets cannot sell the final shared unit twice.
  const scarce = await Inventory.create({ productType: hoodie.productType, color: "Последний", size: "S", clothingTypeId: hoodie.clothingTypeId, quantity: 1 });
  inventories.push(scarce);
  const competing = await Promise.all([newCart(), newCart()]);
  for (const cart of competing) await add(cart, scarce);
  const competingQuotes = await Promise.all(competing.map((cart) => quote(cart)));
  const competed = await Promise.allSettled(competing.map((cart, index) => checkout.create(cart, payload(competingQuotes[index]), crypto.randomUUID())));
  assert.equal(competed.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await scarce.reload()).quantity, 0);

  const sharedCertificate = await issue(1000);
  const certificateCarts = await Promise.all([newCart(), newCart()]);
  await add(certificateCarts[0], hoodie); await add(certificateCarts[1], shirt);
  const certificateQuotes = await Promise.all(certificateCarts.map((cart) => quote(cart, sharedCertificate.code)));
  const certificateAttempts = await Promise.allSettled(certificateCarts.map((cart, index) => checkout.create(cart, payload(certificateQuotes[index], sharedCertificate.code), crypto.randomUUID())));
  assert.equal(certificateAttempts.filter((result) => result.status === "fulfilled").length, 1, "a shared certificate cannot reserve its entire balance for two baskets");
  assert.equal(await CertificateReservation.sum("amountKopecks", { where: { certificateId: sharedCertificate.certificate.id, status: "active" } }), 100000);

  // The actual HTTP cart, invoice and signed bank callback handlers against the
  // same real database. No real CDEK, PayKeeper, email or Telegram requests.
  process.env.PUBLIC_APP_URL = "https://cart-fixture.example";
  process.env.ALLOWED_PUBLIC_ORIGINS = "https://cart-fixture.example";
  process.env.PAYKEEPER_BASE_URL = "https://paykeeper.fixture.test";
  process.env.PAYKEEPER_SECRET_SEED = crypto.randomBytes(24).toString("hex");
  const express = require("express");
  const app = express(); app.use(express.json());
  app.use("/api/cart", require("../routes/cartRoutes").createCartRouter(carts, checkout));
  app.use("/api/payments/paykeeper", require("../routes/payments.paykeeper"));
  app.use("/api/orders", require("../routes/orderRoutes"));
  server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const httpCart = await newCart(); await add(httpCart, hoodie); await add(httpCart, shirt);
  const headers = { Origin: process.env.PUBLIC_APP_URL, "Content-Type": "application/json", "X-Cart-Access-Token": httpCart.token };
  const httpQuoteInput = { revision: (await carts.getCart(httpCart)).revision, officeCode: "KRS1", certificateCode: "" };
  const requestQuote = (body, customHeaders = headers) => fetch(`${base}/cart/${httpCart.cartId}/quote`, { method: "POST", headers: customHeaders, body: JSON.stringify(body) });
  assert.equal((await requestQuote(httpQuoteInput, { ...headers, "X-Cart-Access-Token": "0".repeat(64) })).status, 404);
  assert.equal((await requestQuote({ ...httpQuoteInput, deliveryPrice: 0 })).status, 400);
  const httpQuote = await (await requestQuote(httpQuoteInput)).json();
  const httpInput = { ...httpQuoteInput, quoteHash: httpQuote.quoteHash, buyer, turnstileToken: "fixture" };
  const httpKey = crypto.randomUUID();
  const requestCheckout = (body) => fetch(`${base}/cart/${httpCart.cartId}/checkout`, { method: "POST",
    headers: { ...headers, "Idempotency-Key": httpKey }, body: JSON.stringify(body) });
  assert.equal((await requestCheckout({ ...httpInput, price: 1 })).status, 400);
  const httpResponse = await requestCheckout(httpInput);
  assert.equal(httpResponse.status, 200);
  const httpOrder = await httpResponse.json();
  assert.equal((await (await requestCheckout(httpInput)).json()).orderId, httpOrder.orderId);
  const orderHeaders = { ...headers, "X-Order-Access-Token": httpOrder.orderToken };
  const link = () => fetch(`${base}/payments/paykeeper/link`, { method: "POST", headers: orderHeaders, body: JSON.stringify({ orderId: httpOrder.orderId }) });
  assert.equal((await link()).status, 200); assert.equal((await link()).status, 200);
  assert.equal(invoices.length, 1, "repeated links reuse one invoice for the parent order");
  assert.equal(invoices[0].orderid, String(httpOrder.orderId)); assert.equal(invoices[0].pay_amount, "1.00");
  const bankCallback = (id, amount = "1.00", suffix = "paid") => {
    const paymentId = `http-cart-${suffix}-${id}`;
    const clientId = "fixture";
    const signature = crypto.createHash("md5").update(paymentId + amount + clientId + id + process.env.PAYKEEPER_SECRET_SEED).digest("hex");
    return fetch(`${base}/payments/paykeeper/callback`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id: paymentId, sum: amount, clientid: clientId, orderid: String(id), key: signature }) });
  };
  assert.equal((await bankCallback(httpOrder.orderId, "2.00", "wrong")).status, 400);
  await Order.update({ status: "Оплачено" }, { where: { id: httpOrder.orderId } });
  assert.equal((await bankCallback(httpOrder.orderId)).status, 200);
  assert.equal((await bankCallback(httpOrder.orderId)).status, 200);
  assert.equal((await Order.findByPk(httpOrder.orderId)).paymentStatus, "paid");
  const details = await (await fetch(`${base}/orders/${httpOrder.orderId}`, { headers: orderHeaders })).json();
  assert.equal(details.items.length, 2); assert.equal(details.isCartOrder, true);
  const attachmentList = await (await fetch(`${base}/orders/${httpOrder.orderId}/attachments`, { headers: orderHeaders })).json();
  assert.ok(attachmentList.every((file) => file.orderItemId));
  const photoUrl = `http://127.0.0.1:${server.address().port}${attachmentList[0].downloadUrl}`;
  assert.equal((await fetch(photoUrl)).status, 401);
  assert.deepEqual(Buffer.from(await (await fetch(photoUrl, { headers: orderHeaders })).arrayBuffer()), imageBytes);
  assert.equal((await carts.getCart(httpCart)).items.length, 0);
  assert.equal((await bankCallback(cancelOrder.orderId, "1.00", "late")).status, 200);
  assert.equal((await Order.findByPk(cancelOrder.orderId)).paymentStatus, "review");
  assert.equal((await bankCallback(cancelOrder.orderId, "1.00", "late")).status, 200);
  // Postal checkout: both cart and standalone order pay for merchandise only.
  // The signed city, address and payment mode survive retries and bank returns.
  const postalCity = issueCitySelection({ id: "city:278", name: "Красноярск", label: "г Красноярск", longitude: 92.868, latitude: 56.01 });
  const postalAddress = "660000, Красноярск, Мира, 1";
  for (const denomination of [null, 1000, 20000]) {
    const postalCart = await newCart(); await add(postalCart, hoodie);
    const certificate = denomination ? await issue(denomination) : null;
    const postalInput = { revision: (await carts.getCart(postalCart)).revision, deliveryMethod: "russian_post", postalPoint: postalAddress,
      deliveryCityToken: postalCity.token, certificateCode: certificate?.code || "" };
    const postalQuote = await checkout.quote(postalCart, validateCartQuote(postalInput));
    assert.equal(postalQuote.deliveryPrice, null); assert.equal(postalQuote.deliveryPayLater, true);
    assert.deepEqual(postalQuote.packages, []);
    assert.equal(postalQuote.totalPrice, postalQuote.merchandisePrice);
    const postalCheckout = validateCartCheckout({ ...postalInput, quoteHash: postalQuote.quoteHash, buyer, turnstileToken: "fixture" });
    await assert.rejects(checkout.create(postalCart, { ...postalCheckout, postalPoint: "Другой адрес" }, crypto.randomUUID()), { code: "cart_quote_changed" });
    const postalKey = crypto.randomUUID();
    const postalOrder = await checkout.create(postalCart, postalCheckout, postalKey);
    assert.equal((await checkout.create(postalCart, postalCheckout, postalKey)).orderId, postalOrder.orderId);
    assert.equal(postalOrder.deliveryMode, "russian_post");
    assert.equal(postalOrder.deliveryPayLater, true);
    assert.equal(postalOrder.postalPoint, postalAddress);
    assert.equal(postalOrder.buyer.recipientPhone, "+79998887766");
    assert.equal(await Shipment.count({ where: { orderId: postalOrder.orderId } }), 0);
    const postalHeaders = { Origin: process.env.PUBLIC_APP_URL, "Content-Type": "application/json", "X-Order-Access-Token": postalOrder.orderToken };
    const beforeInvoices = invoices.length;
    if (denomination === 20000) {
      assert.equal(postalOrder.amountDue, 0); assert.equal(postalOrder.requiresBankPayment, false);
      for (let attempt = 0; attempt < 2; attempt++) {
        const completed = await fetch(`${base}/orders/${postalOrder.orderId}/complete-certificate`, { method: "POST", headers: postalHeaders, body: "{}" });
        assert.equal(completed.status, 200);
      }
      assert.equal(invoices.length, beforeInvoices);
    } else {
      assert.equal(postalOrder.amountDue, postalQuote.merchandisePrice - (denomination || 0));
      const linked = await fetch(`${base}/payments/paykeeper/link`, { method: "POST", headers: postalHeaders, body: JSON.stringify({ orderId: postalOrder.orderId }) });
      assert.equal(linked.status, 200); assert.equal(invoices.length, beforeInvoices + 1);
      assert.equal((await bankCallback(postalOrder.orderId)).status, 200);
    }
    assert.equal((await Order.findByPk(postalOrder.orderId)).paymentStatus, "paid");
    assert.equal((await Order.findByPk(postalOrder.orderId)).deliveryAmountKopecks, 0);
    assert.equal(await Shipment.count({ where: { orderId: postalOrder.orderId } }), 0);
  }
  const singlePostal = new FormData();
  for (const [key, value] of Object.entries({ ...buyer, privacyConsent: "true", productType: hoodie.productType, color: hoodie.color, size: hoodie.size,
    embroideryType: "Car", carDesign: "simple", patronusCount: "1", petFaceCount: "1", turnstileToken: "fixture",
    deliveryMethod: "russian_post", deliveryCityToken: postalCity.token, deliveryAddress: postalAddress })) singlePostal.append(key, String(value));
  singlePostal.append("images", new Blob([imageBytes], { type: "image/png" }), "postal.png");
  const singlePostalResponse = await fetch(`${base}/orders/create`, { method: "POST", headers: { Origin: process.env.PUBLIC_APP_URL }, body: singlePostal });
  assert.equal(singlePostalResponse.status, 200);
  const singlePostalOrder = await singlePostalResponse.json();
  assert.equal(singlePostalOrder.pricePending, false);
  assert.equal(singlePostalOrder.totalPrice, singlePostalOrder.merchandisePrice);
  assert.equal(singlePostalOrder.deliveryPayLater, true);
  assert.equal(await Shipment.count({ where: { orderId: singlePostalOrder.orderId } }), 0);
  const singlePostalLink = await fetch(`${base}/payments/paykeeper/link`, { method: "POST",
    headers: { Origin: process.env.PUBLIC_APP_URL, "Content-Type": "application/json", "X-Order-Access-Token": singlePostalOrder.orderToken },
    body: JSON.stringify({ orderId: singlePostalOrder.orderId }) });
  assert.equal(singlePostalLink.status, 200);
  assert.equal((await bankCallback(singlePostalOrder.orderId)).status, 200);
  assert.equal((await Order.findByPk(singlePostalOrder.orderId)).paymentStatus, "paid");
  console.log("[postal-test] Standalone and cart merchandise payment, partial/full certificates, replay and no CDEK shipments verified");
  await new Promise((resolve) => server.close(resolve)); server = null;
  console.log("[cart-checkout-test] Atomic grouped stock, CDEK packages, retry/resume, certificates, cancellation/expiry, stale quotes, file rollback and photo retention verified");
};
run().finally(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  // These are only fixture rows in a database that will immediately be dropped.
  for (const order of await Order.findAll({ where: { isCartOrder: true } })) {
    await CertificateReservation.destroy({ where: { orderId: order.id } });
    await require("../models/GiftCertificateOperation").destroy({ where: { orderId: order.id } });
    await Order.destroy({ where: { id: order.id } });
  }
  await Cart.destroy({ where: { id: ids } });
  await sequelize.close();
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.match(path.basename(root), /^its-cart-checkout-test-/);
  await fs.promises.rm(root, { recursive: true, force: true });
}).catch((error) => { console.error(error); process.exitCode = 1; });
