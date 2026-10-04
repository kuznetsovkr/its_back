// This verifier is only called inside the disposable migration-test database.
if (process.env.NODE_ENV !== "test" || !/^its_migration_test_\d+_\d+$/.test(process.env.DB_NAME || "")) {
  throw new Error("Certificate integration checks require an isolated migration-test database");
}
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
process.env.PAYKEEPER_TEST_MODE = "0";
process.env.CERTIFICATE_CODE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
const sequelize = require("../db");
const Order = require("../models/Order");
const GiftCertificateReservation = require("../models/GiftCertificateReservation");
const GiftCertificateOperation = require("../models/GiftCertificateOperation");
const {
  activateCertificate, commitCertificateForOrder, createCertificatePurchase,
  getCertificateCodeForDelivery, releaseCertificateForOrder, releaseExpiredCertificateReservations,
  reserveCertificateForOrder,
} = require("../services/giftCertificates");

let paymentIndex = 0;
const buyer = { denomination: 1000, fullName: "Покупатель Тестовый", phone: "+79991234567", email: "certificate-test@example.com", privacyConsent: true };
const newPurchase = async (denomination = 1000) => {
  const certificate = await createCertificatePurchase({ ...buyer, denomination });
  assert.equal(certificate.balanceKopecks, 0);
  assert.equal(certificate.codeHash, null);
  assert.equal(certificate.paidAt, null);
  await certificate.update({ paykeeperInvoiceId: `fixture-invoice-${certificate.id}` });
  return certificate;
};
const issue = async (denomination = 1000) => {
  const certificate = await newPurchase(denomination);
  const paymentId = `fixture-payment-${++paymentIndex}`;
  await activateCertificate({ certificateId: certificate.id, paymentId, amountKopecks: certificate.paymentAmountKopecks, paymentConfirmed: true });
  await certificate.reload();
  return { certificate, code: getCertificateCodeForDelivery(certificate), paymentId };
};
const newOrder = () => Order.create({
  firstName: "Тестовый", lastName: "Покупатель", phone: "+79991234567",
  productType: "Худи", color: "Чёрный", size: "M", embroideryType: "Patronus",
  totalPrice: 5000, paymentStatus: "pending",
});
const reserve = (order, code, amount, ttl = 60_000, transaction = null) => reserveCertificateForOrder({
  orderId: order.id, code, productAmountKopecks: amount, expiresAt: new Date(Date.now() + ttl), transaction,
});
const commit = (order, transaction = null) => commitCertificateForOrder({ orderId: order.id, paymentConfirmed: true, transaction });

const run = async () => {
  const pending = await newPurchase();
  const paidArgs = { certificateId: pending.id, paymentId: "fixture-confirmed", amountKopecks: 100_000, paymentConfirmed: true };
  await assert.rejects(activateCertificate({ ...paidArgs, paymentConfirmed: false }), { code: "certificate_payment_unconfirmed" });
  await assert.rejects(activateCertificate({ ...paidArgs, amountKopecks: 1 }), { code: "certificate_payment_amount_mismatch" });
  const activated = await activateCertificate(paidArgs);
  const originalPaidAt = activated.certificate.paidAt.getTime();
  const originalExpiry = activated.certificate.expiresAt.getTime();
  const originalCode = getCertificateCodeForDelivery(activated.certificate);
  assert.equal((await activateCertificate(paidArgs)).activated, false);
  await pending.reload();
  assert.equal(pending.paidAt.getTime(), originalPaidAt);
  assert.equal(pending.expiresAt.getTime(), originalExpiry);
  assert.equal(getCertificateCodeForDelivery(pending), originalCode);
  assert.equal(await GiftCertificateOperation.count({ where: { certificateId: pending.id, type: "issue" } }), 1);
  await assert.rejects(activateCertificate({ ...paidArgs, paymentId: "different-payment" }), { code: "certificate_duplicate_payment" });

  const duplicate = await newPurchase();
  await assert.rejects(activateCertificate({ ...paidArgs, certificateId: duplicate.id }));
  await duplicate.reload();
  assert.equal(duplicate.balanceKopecks, 0, "duplicate payment must roll the activation back");
  assert.equal(duplicate.codeHash, null);

  const withoutKey = await newPurchase();
  const originalKey = process.env.CERTIFICATE_CODE_ENCRYPTION_KEY;
  delete process.env.CERTIFICATE_CODE_ENCRYPTION_KEY;
  try {
    await assert.rejects(activateCertificate({ ...paidArgs, certificateId: withoutKey.id, paymentId: "fixture-without-key" }), { code: "certificate_code_key_missing" });
  } finally {
    process.env.CERTIFICATE_CODE_ENCRYPTION_KEY = originalKey;
  }
  await withoutKey.reload();
  assert.equal(withoutKey.balanceKopecks, 0);
  assert.equal(withoutKey.paidAt, null);
  assert.equal(await GiftCertificateOperation.count({ where: { certificateId: withoutKey.id } }), 0);

  const racingPurchase = await newPurchase();
  const racingArgs = { ...paidArgs, certificateId: racingPurchase.id, paymentId: "fixture-concurrent-payment" };
  const activations = await Promise.all([activateCertificate(racingArgs), activateCertificate(racingArgs)]);
  assert.equal(activations.filter((result) => result.activated).length, 1);
  assert.equal(await GiftCertificateOperation.count({ where: { certificateId: racingPurchase.id, type: "issue" } }), 1);

  await assert.rejects(pending.update({ balanceKopecks: pending.nominalKopecks + 1 }));
  await pending.reload();
  await assert.rejects(sequelize.query('UPDATE "gift_certificates" SET "expiresAt" = NULL WHERE "id" = :id', { replacements: { id: pending.id } }));

  const order1 = await newOrder();
  const order2 = await newOrder();
  await assert.rejects(reserve(order1, originalCode, 500_001), { code: "certificate_product_amount_mismatch" });
  const reservation = await reserve(order1, originalCode, 60_000);
  assert.equal(reservation.amountKopecks, 60_000);
  await pending.reload();
  assert.equal(pending.balanceKopecks, 100_000, "unpaid holds must not debit the balance");
  assert.equal((await reserve(order1, originalCode, 60_000)).id, reservation.id);
  assert.equal((await reserve(order2, originalCode, 80_000)).amountKopecks, 40_000);
  await assert.rejects(commitCertificateForOrder({ orderId: order1.id, paymentConfirmed: false }), { code: "certificate_payment_unconfirmed" });
  await Promise.all([commit(order1), commit(order2), commit(order1)]);
  await pending.reload();
  assert.equal(pending.balanceKopecks, 0);
  assert.equal(pending.status, "used");
  await commit(order1);
  assert.equal(await GiftCertificateOperation.count({ where: { orderId: order1.id } }), 1);
  await releaseCertificateForOrder({ orderId: order1.id });
  await pending.reload();
  assert.equal(pending.balanceKopecks, 0, "paid balances are not automatically refunded");

  const second = await issue();
  const a = await newOrder();
  const b = await newOrder();
  const concurrent = await Promise.allSettled([reserve(a, second.code, 100_000), reserve(b, second.code, 100_000)]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.find((result) => result.status === "rejected").reason.code, "certificate_balance_reserved");
  const winning = concurrent[0].status === "fulfilled" ? a : b;
  await releaseCertificateForOrder({ orderId: winning.id });
  await second.certificate.reload();
  assert.equal(second.certificate.balanceKopecks, 100_000);
  await reserve(winning, second.code, 100_000);
  const other = await issue();
  await assert.rejects(reserve(winning, other.code, 100_000), { code: "certificate_order_conflict" });
  const expiryReservation = await GiftCertificateReservation.findOne({ where: { orderId: winning.id } });
  await expiryReservation.update({ expiresAt: new Date(Date.now() - 1000) });
  await releaseExpiredCertificateReservations();
  await expiryReservation.reload();
  assert.equal(expiryReservation.status, "released");
  await commit(winning); // A delayed bank callback may reacquire an unspent hold.
  await second.certificate.reload();
  assert.equal(second.certificate.balanceKopecks, 0);

  const late = await issue();
  const oldOrder = await newOrder();
  const newPaidOrder = await newOrder();
  await reserve(oldOrder, late.code, 100_000);
  await GiftCertificateReservation.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { orderId: oldOrder.id } });
  await reserve(newPaidOrder, late.code, 100_000);
  await commit(newPaidOrder);
  await assert.rejects(commit(oldOrder), { code: "certificate_used" });
  assert.equal(await GiftCertificateOperation.count({ where: { orderId: oldOrder.id } }), 0);

  const insufficient = await issue();
  const insufficientOldOrder = await newOrder();
  const partialNewOrder = await newOrder();
  await reserve(insufficientOldOrder, insufficient.code, 80_000);
  await GiftCertificateReservation.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { orderId: insufficientOldOrder.id } });
  await reserve(partialNewOrder, insufficient.code, 50_000);
  await commit(partialNewOrder);
  await assert.rejects(commit(insufficientOldOrder), { code: "paid_order_certificate_unavailable" });
  await insufficient.certificate.reload();
  assert.equal(insufficient.certificate.balanceKopecks, 50_000);
  assert.equal(await GiftCertificateOperation.count({ where: { orderId: insufficientOldOrder.id } }), 0);

  const rollback = await issue();
  const rollbackOrder = await newOrder();
  await reserve(rollbackOrder, rollback.code, 100_000);
  await assert.rejects(sequelize.transaction(async (tx) => {
    await commit(rollbackOrder, tx);
    throw new Error("fixture later payment failure");
  }), /fixture later payment failure/);
  await rollback.certificate.reload();
  assert.equal(rollback.certificate.balanceKopecks, 100_000);
  assert.equal(await GiftCertificateOperation.count({ where: { orderId: rollbackOrder.id } }), 0);
  assert.equal((await GiftCertificateReservation.findOne({ where: { orderId: rollbackOrder.id } })).status, "active");

  const historical = await issue();
  const historicOrder = await newOrder();
  await historical.certificate.update({ paidAt: new Date("2020-01-01T00:00:00.000Z"), expiresAt: new Date("2021-01-01T00:00:00.000Z") });
  await assert.rejects(reserve(historicOrder, historical.code, 100_000), { code: "certificate_expired" });
  await assert.rejects(reserve(historicOrder, originalCode, 100_000), { code: "certificate_used" });

  process.env.PAYKEEPER_TEST_MODE = "1";
  const testPurchase = await issue(20000);
  assert.equal(testPurchase.certificate.paymentAmountKopecks, 100);
  assert.equal(testPurchase.certificate.balanceKopecks, 2_000_000);
  const testOrder = await newOrder();
  await reserve(testOrder, testPurchase.code, 100_000);
  process.env.PAYKEEPER_TEST_MODE = "0";
  const liveOrder = await newOrder();
  await assert.rejects(reserve(liveOrder, testPurchase.code, 100_000), { code: "certificate_mode_mismatch" });
  await commit(testOrder); // An earlier test invoice retains its original mode.
  console.log("[certificate-test] Payment replay, row-lock concurrency, reservation expiry, rollback and test-mode isolation passed");
};

run().catch((error) => {
  console.error("[certificate-test] Failed:", error.message);
  process.exitCode = 1;
}).finally(() => sequelize.close());
