const crypto = require("node:crypto");
const { UniqueConstraintError } = require("sequelize");
const sequelize = require("../db");
const Certificate = require("../models/GiftCertificate");
const Delivery = require("../models/GiftCertificateDelivery");
const { createInvoice, searchInvoices } = require("../lib/paykeeper");
const { assertCertificateCheckoutConfigured, isCertificateCheckoutConfigured } = require("../config/certificateCheckout");
const { createCertificateAccessToken } = require("../middleware/certificateAccess");
const { CERTIFICATE_DENOMINATIONS, GiftCertificateError, getCertificateStatus, validateCertificatePurchaseInput } = require("../lib/giftCertificateRules");
const { createCertificatePurchase, activateCertificate } = require("./giftCertificates");
const { createTurnstileVerifier, getPublicTurnstileConfig } = require("./turnstileVerification");
const verifyCertificateChallenge = createTurnstileVerifier({ action: "certificate_purchase" });
const { verifyCertificateMail } = require("./certificateMail");
const { queueCertificateDelivery } = require("./certificateDelivery");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const getPublicCertificateConfig = () => ({
  enabled: isCertificateCheckoutConfigured(), denominations: CERTIFICATE_DENOMINATIONS,
  testMode: process.env.PAYKEEPER_TEST_MODE === "1",
  turnstile: { ...getPublicTurnstileConfig(), action: "certificate_purchase" },
});
const certificatePayUrl = (invoiceId) => String(process.env.PAYKEEPER_BASE_URL || "").replace(/\/$/, "")
  + "/bill/" + encodeURIComponent(invoiceId) + "/";
const purchaseResponse = (certificate) => ({
  certificateId: certificate.id, certificateToken: createCertificateAccessToken(certificate.id),
  nominalKopecks: certificate.nominalKopecks, paymentAmountKopecks: certificate.paymentAmountKopecks,
  testMode: certificate.testMode,
});
const beginCertificateCheckout = async ({ body, requestKey, remoteIp }) => {
  assertCertificateCheckoutConfigured();
  const input = validateCertificatePurchaseInput(body);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestKey || "")) {
    throw new GiftCertificateError("Обновите форму и попробуйте ещё раз", "invalid_certificate_request", 400);
  }
  const purchaseRequestHash = sha256(requestKey.toLowerCase());
  const { turnstileToken, ...buyer } = input;
  const checkoutInputHash = sha256(JSON.stringify(buyer));
  const existingResponse = (certificate) => {
    if (certificate.checkoutInputHash !== checkoutInputHash) {
      throw new GiftCertificateError("Эта попытка покупки уже сохранена с другими данными", "certificate_checkout_conflict");
    }
    return purchaseResponse(certificate);
  };
  const existing = await Certificate.findOne({ where: { purchaseRequestHash } });
  if (existing) return existingResponse(existing);
  await verifyCertificateChallenge({ token: turnstileToken, remoteIp });
  await verifyCertificateMail();
  try {
    const certificate = await sequelize.transaction(async (transaction) => {
      const created = await createCertificatePurchase(body, transaction);
      return created.update({ purchaseRequestHash, checkoutInputHash }, { transaction });
    });
    return purchaseResponse(certificate);
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    const concurrent = await Certificate.findOne({ where: { purchaseRequestHash } });
    if (!concurrent) throw error;
    return existingResponse(concurrent);
  }
};
const createCertificatePaymentLink = async (certificateId) => {
  assertCertificateCheckoutConfigured();
  await verifyCertificateMail();
  const intent = await sequelize.transaction(async (transaction) => {
    const certificate = await Certificate.findByPk(certificateId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!certificate) throw new GiftCertificateError("Покупка сертификата не найдена", "certificate_not_found", 404);
    if (certificate.paidAt) throw new GiftCertificateError("Сертификат уже оплачен", "certificate_already_paid");
    // Prevent a pending test purchase from turning into a production purchase.
    if (certificate.testMode !== (process.env.PAYKEEPER_TEST_MODE === "1")) {
      throw new GiftCertificateError("Режим оплаты изменился. Начните новую покупку сертификата", "certificate_mode_mismatch");
    }
    if (certificate.paykeeperInvoiceId) return { certificate, existing: true };
    if (certificate.invoiceRequestedAt) return { certificate, recover: true };
    await certificate.update({ invoiceRequestedAt: new Date() }, { transaction });
    return { certificate, create: true };
  });
  const { certificate } = intent;
  if (!intent.existing) {
    let invoiceId;
    if (intent.recover) {
      // Never issue a second invoice after an ambiguous remote timeout.
      const invoices = await searchInvoices({
        query: "certificate-" + certificate.id,
        startDate: new Date(new Date(certificate.invoiceRequestedAt).getTime() - 86_400_000).toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      });
      const matches = invoices.filter((invoice) => invoice.orderid === "certificate-" + certificate.id
        && Math.round(Number(invoice.pay_amount) * 100) === certificate.paymentAmountKopecks
        && ["created", "sent", "paid"].includes(invoice.status));
      if (matches.length !== 1) {
        throw new GiftCertificateError("Проверяем ранее запрошенный счёт. Попробуйте позже; повторно платить не нужно", "certificate_invoice_uncertain");
      }
      invoiceId = String(matches[0].id);
    } else {
      const invoice = await createInvoice({
        pay_amount: (certificate.paymentAmountKopecks / 100).toFixed(2),
        orderid: "certificate-" + certificate.id, clientid: certificate.buyerFullName,
        client_email: certificate.buyerEmail, client_phone: certificate.buyerPhone,
        service_name: "Подарочный сертификат #" + certificate.id,
      });
      invoiceId = String(invoice.invoice_id || "");
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(invoiceId)) throw new Error("Invalid certificate invoice ID");
    await certificate.update({ paykeeperInvoiceId: invoiceId });
  }
  return {
    pay_url: certificatePayUrl(certificate.paykeeperInvoiceId),
    paymentAmountKopecks: certificate.paymentAmountKopecks, testMode: certificate.testMode,
  };
};
const handleCertificatePaykeeperCallback = async ({ certificateId, paymentId, amountKopecks }) => sequelize.transaction(async (transaction) => {
  const result = await activateCertificate({ certificateId, paymentId, amountKopecks, paymentConfirmed: true, transaction });
  await queueCertificateDelivery(result.certificate.id, transaction);
  return { activated: result.activated };
});
const getCertificatePurchaseStatus = async (id) => {
  const certificate = await Certificate.findByPk(id);
  if (!certificate) throw new GiftCertificateError("Покупка сертификата не найдена", "certificate_not_found", 404);
  const delivery = certificate.paidAt ? await Delivery.findOne({ where: { certificateId: id } }) : null;
  // Explicit allowlist: never serialize the model, ciphertext, hashes or buyer details.
  return {
    certificateId: certificate.id, status: getCertificateStatus(certificate), paid: Boolean(certificate.paidAt),
    nominalKopecks: certificate.nominalKopecks, paymentAmountKopecks: certificate.paymentAmountKopecks,
    testMode: certificate.testMode, expiresAt: certificate.expiresAt,
    emailDelivery: delivery?.status === "sent" ? "sent" : delivery?.status === "failed" ? "failed" : "pending",
  };
};
module.exports = {
  beginCertificateCheckout, createCertificatePaymentLink, getCertificatePurchaseStatus,
  getPublicCertificateConfig, handleCertificatePaykeeperCallback,
};
