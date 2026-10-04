const { Op } = require("sequelize");
const sequelize = require("../db");
const GiftCertificate = require("../models/GiftCertificate");
const GiftCertificateReservation = require("../models/GiftCertificateReservation");
const GiftCertificateOperation = require("../models/GiftCertificateOperation");
const Order = require("../models/Order");
const { isPaykeeperTestMode, resolvePaykeeperAmount } = require("./paymentMode");
const {
  CERTIFICATE_STATUS, GiftCertificateError, assertKopecks, certificateExpiresAt,
  generateCertificateCode, getCertificateStatus, hashCertificateCode, validateCertificatePurchaseInput,
} = require("../lib/giftCertificateRules");
const { encryptCertificateCode, decryptCertificateCode } = require("../lib/giftCertificateCodeVault");

const inTransaction = (transaction, callback) => transaction ? callback(transaction) : sequelize.transaction(callback);
const assertId = (value) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new GiftCertificateError("Некорректный номер заказа или сертификата", "invalid_certificate_reference", 400);
  }
};
const lockOrder = async (orderId, transaction) => {
  assertId(orderId);
  const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!order) throw new GiftCertificateError("Заказ не найден", "certificate_order_not_found", 404);
  return order;
};
const assertRedeemable = (certificate, now, testMode) => {
  if (!certificate) throw new GiftCertificateError("Сертификат не найден", "certificate_not_found", 404);
  const status = getCertificateStatus(certificate, now);
  if (status === CERTIFICATE_STATUS.PENDING) {
    throw new GiftCertificateError("Сертификат ещё не оплачен", "certificate_unpaid");
  }
  if (status === CERTIFICATE_STATUS.ANNULLED) {
    throw new GiftCertificateError("Срок действия сертификата истёк или он аннулирован", "certificate_expired");
  }
  if (status === CERTIFICATE_STATUS.USED) {
    throw new GiftCertificateError("Баланс сертификата уже использован", "certificate_used");
  }
  assertKopecks(certificate.balanceKopecks);
  if (certificate.balanceKopecks > certificate.nominalKopecks) {
    throw new GiftCertificateError("Сертификат требует проверки", "invalid_certificate_balance", 422);
  }
  if (certificate.testMode !== testMode) {
    throw new GiftCertificateError("Тестовый и обычный режимы сертификатов несовместимы", "certificate_mode_mismatch");
  }
};

// All callers must lock the order BEFORE its certificate. Certificate row locks
// serialize reservations/debits across different orders using the same code.
const reservedByOtherOrders = async (certificateId, orderId, now, transaction) => Number(
  await GiftCertificateReservation.sum("amountKopecks", {
    where: {
      certificateId, orderId: { [Op.ne]: orderId }, status: "active", expiresAt: { [Op.gt]: now },
    }, transaction,
  }) || 0
);

const createCertificatePurchase = async (body, transaction = null) => {
  const input = validateCertificatePurchaseInput(body);
  const testMode = isPaykeeperTestMode();
  return GiftCertificate.create({
    buyerFullName: input.fullName, buyerPhone: input.phone, buyerEmail: input.email,
    preferredContact: input.preferredContact || null, comment: input.comment || null,
    privacyConsentAt: new Date(), nominalKopecks: input.denomination * 100, balanceKopecks: 0,
    paymentAmountKopecks: Math.round(resolvePaykeeperAmount(input.denomination) * 100),
    testMode, status: CERTIFICATE_STATUS.PENDING,
  }, transaction ? { transaction } : {});
};

const activateCertificate = async ({ certificateId, paymentId, amountKopecks, paymentConfirmed, transaction = null }) => {
  assertId(certificateId);
  assertKopecks(amountKopecks);
  if (paymentConfirmed !== true || typeof paymentId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(paymentId)) {
    throw new GiftCertificateError("Оплата сертификата не подтверждена", "certificate_payment_unconfirmed", 403);
  }
  return inTransaction(transaction, async (tx) => {
    const certificate = await GiftCertificate.findByPk(certificateId, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!certificate) throw new GiftCertificateError("Сертификат не найден", "certificate_not_found", 404);
    if (certificate.paymentAmountKopecks !== amountKopecks) {
      throw new GiftCertificateError("Сумма оплаты сертификата не совпадает", "certificate_payment_amount_mismatch", 400);
    }
    if (certificate.paidAt) {
      if (certificate.paykeeperPaymentId !== paymentId) {
        throw new GiftCertificateError("Сертификат уже оплачен, повторный платёж требует проверки", "certificate_duplicate_payment");
      }
      return { certificate, activated: false };
    }
    if (certificate.status !== CERTIFICATE_STATUS.PENDING || !certificate.paykeeperInvoiceId) {
      throw new GiftCertificateError("Не найден ожидающий оплаты счёт сертификата", "certificate_invoice_not_ready");
    }
    const now = new Date();
    const { code, codeHash } = generateCertificateCode();
    // Code creation, encrypted delivery copy, balance and ledger commit together.
    await certificate.update({
      status: CERTIFICATE_STATUS.ACTIVE, balanceKopecks: certificate.nominalKopecks,
      paidAt: now, expiresAt: certificateExpiresAt(now), paykeeperPaymentId: paymentId,
      codeHash, codeEncrypted: encryptCertificateCode(code, certificate.id),
    }, { transaction: tx });
    await GiftCertificateOperation.create({
      certificateId: certificate.id, orderId: null, type: "issue",
      deltaKopecks: certificate.nominalKopecks, balanceAfterKopecks: certificate.nominalKopecks,
      idempotencyKey: `certificate:${certificate.id}:issue`,
    }, { transaction: tx });
    return { certificate, activated: true };
  });
};

// Internal delivery worker only: never put this code/hash/encrypted copy into a
// catalogue, an admin list, logs or an unauthenticated status response.
const getCertificateCodeForDelivery = (certificate) => {
  if (!certificate.paidAt || !certificate.codeEncrypted) {
    throw new GiftCertificateError("Сертификат ещё не выдан", "certificate_unpaid");
  }
  const code = decryptCertificateCode(certificate.codeEncrypted, certificate.id);
  if (hashCertificateCode(code) !== certificate.codeHash) {
    throw new GiftCertificateError("Код сертификата требует проверки", "certificate_code_corrupted", 503);
  }
  return code;
};

const reserveCertificateForOrder = async ({ orderId, code, productAmountKopecks, expiresAt, transaction = null }) => {
  assertKopecks(productAmountKopecks);
  const codeHash = hashCertificateCode(code);
  const deadline = new Date(expiresAt);
  if (expiresAt == null || !Number.isFinite(deadline.getTime())) {
    throw new GiftCertificateError("Некорректный срок резерва", "invalid_certificate_reservation_expiry", 422);
  }
  return inTransaction(transaction, async (tx) => {
    const order = await lockOrder(orderId, tx);
    if (order.paymentStatus !== "pending" || order.paykeeperInvoiceId) {
      throw new GiftCertificateError("Сертификат нужно выбрать до создания счёта на оплату", "certificate_order_not_editable");
    }
    // This is a trusted product-only quote from the server, never a client price.
    if (productAmountKopecks > Number(order.totalPrice) * 100 || !(Number(order.totalPrice) > 0)) {
      throw new GiftCertificateError("Стоимость изделия требует проверки", "certificate_product_amount_mismatch", 422);
    }
    const certificate = await GiftCertificate.findOne({ where: { codeHash }, transaction: tx, lock: tx.LOCK.UPDATE });
    const now = new Date();
    assertRedeemable(certificate, now, isPaykeeperTestMode());
    const reservation = await GiftCertificateReservation.findOne({ where: { orderId }, transaction: tx, lock: tx.LOCK.UPDATE });
    if (reservation && (reservation.certificateId !== certificate.id || reservation.eligibleAmountKopecks !== productAmountKopecks)) {
      throw new GiftCertificateError("К заказу уже применён другой сертификат или изменена стоимость", "certificate_order_conflict");
    }
    if (reservation?.status === "committed") {
      throw new GiftCertificateError("Сертификат для заказа уже использован", "certificate_order_not_editable");
    }
    if (reservation?.status === "active" && new Date(reservation.expiresAt) > now) return reservation;
    const expiry = new Date(Math.min(deadline.getTime(), new Date(certificate.expiresAt).getTime()));
    if (expiry <= now) throw new GiftCertificateError("Срок оплаты заказа истёк", "certificate_reservation_expired");
    const reserved = await reservedByOtherOrders(certificate.id, orderId, now, tx);
    const available = certificate.balanceKopecks - reserved;
    if (available <= 0) {
      throw new GiftCertificateError("Баланс сертификата зарезервирован в другом заказе. Завершите его оплату или попробуйте позже", "certificate_balance_reserved");
    }
    const values = {
      certificateId: certificate.id, orderId, eligibleAmountKopecks: productAmountKopecks,
      amountKopecks: Math.min(available, productAmountKopecks), testMode: certificate.testMode,
      status: "active", expiresAt: expiry, committedAt: null, releasedAt: null, releaseReason: null,
    };
    return reservation ? reservation.update(values, { transaction: tx }) : GiftCertificateReservation.create(values, { transaction: tx });
  });
};

const lockOrderCertificateReservation = async (orderId, tx) => {
  const order = await lockOrder(orderId, tx);
  // The order row serializes any change to its certificate linkage.
  const reference = await GiftCertificateReservation.findOne({ where: { orderId }, transaction: tx });
  if (!reference) return { order, certificate: null, reservation: null };
  const certificate = await GiftCertificate.findByPk(reference.certificateId, { transaction: tx, lock: tx.LOCK.UPDATE });
  const reservation = await GiftCertificateReservation.findByPk(reference.id, { transaction: tx, lock: tx.LOCK.UPDATE });
  if (!certificate || !reservation) {
    throw new GiftCertificateError("Резерв сертификата требует проверки", "invalid_certificate_reservation", 422);
  }
  return { order, certificate, reservation };
};

const commitCertificateForOrder = async ({ orderId, paymentConfirmed, transaction = null }) => {
  if (paymentConfirmed !== true) {
    throw new GiftCertificateError("Оплата заказа не подтверждена", "certificate_payment_unconfirmed", 403);
  }
  return inTransaction(transaction, async (tx) => {
    const { certificate, reservation } = await lockOrderCertificateReservation(orderId, tx);
    if (!reservation) return null;
    if (reservation.status === "committed") return reservation;
    const now = new Date();
    // Compare with the server-stored order mode, so changing the global test-mode
    // switch cannot break a genuine callback for an already-created test invoice.
    assertRedeemable(certificate, now, reservation.testMode);
    const others = await reservedByOtherOrders(certificate.id, orderId, now, tx);
    const available = certificate.balanceKopecks - others;
    if (available < reservation.amountKopecks) {
      // A late bank confirmation must go to manual review, not double-spend or
      // silently shrink the discount of an invoice that has already been paid.
      throw new GiftCertificateError("Оплата пришла после истечения резерва, баланс сертификата требует проверки", "paid_order_certificate_unavailable");
    }
    const balance = certificate.balanceKopecks - reservation.amountKopecks;
    await certificate.update({
      balanceKopecks: balance, status: balance === 0 ? CERTIFICATE_STATUS.USED : CERTIFICATE_STATUS.ACTIVE,
    }, { transaction: tx });
    await GiftCertificateOperation.create({
      certificateId: certificate.id, orderId, type: "debit", deltaKopecks: -reservation.amountKopecks,
      balanceAfterKopecks: balance, idempotencyKey: `order:${orderId}:gift-debit`,
    }, { transaction: tx });
    await reservation.update({ status: "committed", committedAt: now, releasedAt: null, releaseReason: null }, { transaction: tx });
    return reservation;
  });
};

const releaseCertificateForOrder = async ({ orderId, reason = "cancelled", onlyIfExpired = false, transaction = null }) => {
  if (!["cancelled", "expired", "payment_failed"].includes(reason)) {
    throw new GiftCertificateError("Некорректная причина освобождения резерва", "invalid_certificate_release_reason", 422);
  }
  return inTransaction(transaction, async (tx) => {
    const { reservation } = await lockOrderCertificateReservation(orderId, tx);
    if (!reservation || reservation.status !== "active") return reservation;
    const now = new Date();
    if (onlyIfExpired && new Date(reservation.expiresAt) > now) return reservation;
    // No balance increment: an unpaid reservation never debited the balance.
    // A committed debit is never automatically refunded (manual business rule).
    await reservation.update({ status: "released", releasedAt: now, releaseReason: reason }, { transaction: tx });
    return reservation;
  });
};

const releaseExpiredCertificateReservations = async () => {
  const candidates = await GiftCertificateReservation.findAll({
    where: { status: "active", expiresAt: { [Op.lte]: new Date() } }, attributes: ["orderId"],
  });
  for (const { orderId } of candidates) {
    await releaseCertificateForOrder({ orderId, reason: "expired", onlyIfExpired: true });
  }
  return candidates.length;
};

module.exports = {
  activateCertificate, commitCertificateForOrder, createCertificatePurchase,
  getCertificateCodeForDelivery, releaseCertificateForOrder,
  releaseExpiredCertificateReservations, reserveCertificateForOrder,
};
