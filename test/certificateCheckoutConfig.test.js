const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const { getCertificateMailConfig, isCertificateCheckoutConfigured } = require("../config/certificateCheckout");
const { createCertificateAccessToken, verifyCertificateAccessToken } = require("../middleware/certificateAccess");
const { buildCertificateEmail } = require("../services/certificateMail");
const enabled = {
  CERTIFICATE_PURCHASE_ENABLED: "1", CERTIFICATE_ACCESS_SECRET: "b2".repeat(32),
  CERTIFICATE_CODE_ENCRYPTION_KEY: "a1".repeat(32),
  CERTIFICATE_SMTP_HOST: "smtp.example.com", CERTIFICATE_SMTP_PORT: "465",
  CERTIFICATE_SMTP_USER: "sender", CERTIFICATE_SMTP_PASSWORD: "fixture-smtp-password",
  CERTIFICATE_MAIL_FROM: "sender@example.com", PAYKEEPER_BASE_URL: "https://pay.example.com",
  PAYKEEPER_LOGIN: "fixture", PAYKEEPER_PASSWORD: "fixture", PAYKEEPER_SECRET_SEED: "fixture-paykeeper-secret",
};
test("certificate purchase stays disabled until all independent secrets, SMTP and PayKeeper settings exist", () => {
  assert.equal(isCertificateCheckoutConfigured(enabled), true);
  for (const field of Object.keys(enabled)) assert.equal(isCertificateCheckoutConfigured({ ...enabled, [field]: "" }), false, field);
  assert.equal(isCertificateCheckoutConfigured({ ...enabled, CERTIFICATE_ACCESS_SECRET: enabled.CERTIFICATE_CODE_ENCRYPTION_KEY.toUpperCase() }), false);
  assert.equal(isCertificateCheckoutConfigured({ ...enabled, JWT_SECRET: enabled.CERTIFICATE_ACCESS_SECRET }), false);
  assert.equal(isCertificateCheckoutConfigured({ ...enabled, ORDER_ACCESS_SECRET: enabled.CERTIFICATE_CODE_ENCRYPTION_KEY.toUpperCase() }), false);
  assert.equal(isCertificateCheckoutConfigured({ ...enabled, PAYKEEPER_BASE_URL: "http://pay.example.com" }), false);
});
test("certificate mail requires encrypted SMTP and a single sender address", () => {
  assert.equal(getCertificateMailConfig(enabled).secure, true);
  const startTls = getCertificateMailConfig({ ...enabled, CERTIFICATE_SMTP_PORT: "587" });
  assert.equal(startTls.requireTLS, true);
  assert.equal(startTls.disableFileAccess, true);
  assert.equal(startTls.disableUrlAccess, true);
  for (const from of ["sender@example.com,other@example.com", "sender@example.com\r\nBcc:other@example.com"]) {
    assert.equal(getCertificateMailConfig({ ...enabled, CERTIFICATE_MAIL_FROM: from }), null);
  }
  assert.equal(getCertificateMailConfig({ ...enabled, CERTIFICATE_SMTP_PORT: "25" }), null);
});
test("certificate access tokens cannot be used with another secret, audience, purpose or after expiry", () => {
  const token = createCertificateAccessToken(42, enabled);
  assert.equal(verifyCertificateAccessToken(token, enabled).certificateId, 42);
  assert.equal(verifyCertificateAccessToken(token, { ...enabled, CERTIFICATE_ACCESS_SECRET: "c3".repeat(32) }), null);
  const options = { algorithm: "HS256", audience: "its-certificate-purchase", issuer: "its" };
  for (const payload of [{ certificateId: 42, purpose: "order" }, { certificateId: -1, purpose: "certificate_purchase" }, { certificateId: 42, purpose: "certificate_purchase", exp: 1 }]) {
    assert.equal(verifyCertificateAccessToken(jwt.sign(payload, enabled.CERTIFICATE_ACCESS_SECRET, options), enabled), null);
  }
  assert.equal(verifyCertificateAccessToken(jwt.sign({ certificateId: 42 }, enabled.CERTIFICATE_ACCESS_SECRET, { ...options, audience: "admin" }), enabled), null);
  assert.equal(verifyCertificateAccessToken(token + "x", enabled), null);
});
test("certificate mail goes only to the buyer, has a stable message ID and marks test certificates", () => {
  const certificate = { id: 42, buyerEmail: "buyer@example.com", buyerFullName: "Иванов Иван", nominalKopecks: 200_000, expiresAt: "2027-10-04T12:00:00Z", testMode: false };
  const message = buildCertificateEmail(certificate, "fixture-code", enabled.CERTIFICATE_MAIL_FROM);
  assert.deepEqual(message.envelope.to, ["buyer@example.com"]);
  assert.deepEqual(message.to, [{ address: "buyer@example.com" }]);
  assert.equal(message.bcc, undefined);
  assert.equal(message.cc, undefined);
  assert.match(message.text, /fixture-code/);
  assert.match(message.text, /не доставку/);
  assert.equal(message.messageId, buildCertificateEmail(certificate, "fixture-code", enabled.CERTIFICATE_MAIL_FROM).messageId);
  assert.match(buildCertificateEmail({ ...certificate, testMode: true }, "fixture-code", enabled.CERTIFICATE_MAIL_FROM).subject, /ТЕСТ/);
});
