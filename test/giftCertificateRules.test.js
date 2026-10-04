const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  CERTIFICATE_DENOMINATIONS, certificateExpiresAt, generateCertificateCode, getCertificateStatus,
  hashCertificateCode, normalizeCertificateCode, planCertificatePayment, validateCertificatePurchaseInput,
} = require("../lib/giftCertificateRules");
const { decryptCertificateCode, encryptCertificateCode } = require("../lib/giftCertificateCodeVault");

const buyer = {
  denomination: 2000, fullName: "Иванов Иван", phone: "8 (999) 123-45-67",
  email: "Buyer@Example.COM", privacyConsent: true,
};
const key = { CERTIFICATE_CODE_ENCRYPTION_KEY: "a2".repeat(32) };

test("certificate purchase accepts only the agreed denominations and normalizes buyer data", () => {
  for (const denomination of CERTIFICATE_DENOMINATIONS) {
    const result = validateCertificatePurchaseInput({ ...buyer, denomination });
    assert.equal(result.denomination, denomination);
    assert.equal(result.email, "buyer@example.com");
    assert.equal(result.phone, "+79991234567");
  }
});

test("certificate purchase rejects custom prices, forged financial fields and another recipient", () => {
  for (const denomination of [0, -1, 1500, 7000, 20001, "2000", 2000.5]) {
    assert.throws(() => validateCertificatePurchaseInput({ ...buyer, denomination }), { field: "denomination" });
  }
  for (const field of ["balanceKopecks", "paymentAmountKopecks", "testMode", "status", "recipientEmail", "telegramChatId"]) {
    assert.throws(() => validateCertificatePurchaseInput({ ...buyer, [field]: "forged" }), { code: "validation_failed" });
  }
});

test("certificate purchase requires a buyer, valid phone, email and explicit consent", () => {
  for (const [field, value] of [["fullName", "Иван"], ["fullName", "Иванов <Иван>"], ["phone", "123"], ["email", ""], ["email", "bad"], ["privacyConsent", false], ["privacyConsent", "true"]]) {
    assert.throws(() => validateCertificatePurchaseInput({ ...buyer, [field]: value }), { field });
  }
  assert.throws(() => validateCertificatePurchaseInput({ ...buyer, preferredContact: "Telegram\r\nInjected" }), { field: "preferredContact" });
});

test("certificate email is one mailbox rather than a recipient list or header", () => {
  for (const email of ["buyer,other@example.com", "Buyer <buyer@example.com>", "buyer@example.com,other@example.com", "buyer\r\nBcc:other@example.com", ".buyer@example.com", "buyer..test@example.com", "buyer@-example.com", `${"a".repeat(65)}@example.com`]) {
    assert.throws(() => validateCertificatePurchaseInput({ ...buyer, email }), { field: "email" });
  }
  assert.equal(validateCertificatePurchaseInput({ ...buyer, email: "buyer+gift@example.co.uk" }).email, "buyer+gift@example.co.uk");
});

test("certificate year starts at paid time and clamps February 29 to February 28", () => {
  assert.equal(certificateExpiresAt("2026-10-04T12:34:56.789Z").toISOString(), "2027-10-04T12:34:56.789Z");
  assert.equal(certificateExpiresAt("2024-02-29T12:00:00.000Z").toISOString(), "2025-02-28T12:00:00.000Z");
  for (const date of [null, "invalid"]) assert.throws(() => certificateExpiresAt(date), { code: "invalid_certificate_date" });
});

test("certificate statuses distinguish pending, active, exhausted and exact expiry", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  const issued = { status: "active", paidAt: new Date("2025-10-05T00:00:00Z"), expiresAt: new Date("2026-10-05T00:00:00Z"), balanceKopecks: 100 };
  assert.equal(getCertificateStatus({ status: "pending", paidAt: null }, now), "pending");
  assert.equal(getCertificateStatus(issued, now), "active");
  assert.equal(getCertificateStatus({ ...issued, balanceKopecks: 0 }, now), "used");
  assert.equal(getCertificateStatus({ ...issued, expiresAt: now }, now), "annulled");
  assert.equal(getCertificateStatus({ ...issued, status: "annulled" }, now), "annulled");
  assert.throws(() => getCertificateStatus({ ...issued, expiresAt: null }, now), { code: "invalid_certificate_state" });
});

test("certificate discount covers the finished product but never delivery", () => {
  assert.deepEqual(planCertificatePayment({ productKopecks: 600000, deliveryKopecks: 45055, availableKopecks: 1000000 }), {
    discountKopecks: 600000, productRemainderKopecks: 0, deliveryKopecks: 45055, payableKopecks: 45055,
  });
  assert.equal(planCertificatePayment({ productKopecks: 600000, deliveryKopecks: 45055, availableKopecks: 200000 }).payableKopecks, 445055);
  assert.equal(planCertificatePayment({ productKopecks: 600000, deliveryKopecks: 0, availableKopecks: 600000 }).payableKopecks, 0);
  assert.equal(planCertificatePayment({ productKopecks: 600000, deliveryKopecks: 1, availableKopecks: 0 }).payableKopecks, 600001);
});

test("certificate calculation rejects fractional kopecks, negatives, overflows and invalid balances", () => {
  for (const value of [1.5, -1, NaN, Infinity, "100", 2_147_483_648]) {
    assert.throws(() => planCertificatePayment({ productKopecks: value, deliveryKopecks: 0, availableKopecks: 100 }));
  }
  assert.throws(() => planCertificatePayment({ productKopecks: 100, deliveryKopecks: -1, availableKopecks: 100 }));
  assert.throws(() => planCertificatePayment({ productKopecks: 100, deliveryKopecks: 0, availableKopecks: 2_000_001 }));
  assert.throws(() => planCertificatePayment({ productKopecks: 2_147_483_647, deliveryKopecks: 1, availableKopecks: 0 }));
});

test("certificate codes have 128-bit random content and stable case/dash normalization", () => {
  const hashes = new Set();
  for (let index = 0; index < 100; index += 1) {
    const { code, codeHash } = generateCertificateCode();
    assert.match(code, /^ITS(?:-[A-F0-9]{4}){8}$/);
    assert.equal(hashCertificateCode(code.toLowerCase().replace(/-/g, " ")), codeHash);
    hashes.add(codeHash);
  }
  assert.equal(hashes.size, 100);
  for (const code of [null, "", "ITS-1234", "A".repeat(100), "ITS" + "G".repeat(32)]) {
    assert.throws(() => normalizeCertificateCode(code), { code: "invalid_certificate_code" });
  }
});

test("encrypted delivery codes use independent random nonces and bind to their certificate", () => {
  const { code } = generateCertificateCode();
  const first = encryptCertificateCode(code, 1, key);
  const second = encryptCertificateCode(code, 1, key);
  assert.notEqual(first, second);
  assert.equal(first.includes(code), false);
  assert.equal(decryptCertificateCode(first, 1, key), code);
  assert.throws(() => decryptCertificateCode(first, 2, key), { code: "certificate_code_unreadable" });
  assert.throws(() => decryptCertificateCode(first, 1, { CERTIFICATE_CODE_ENCRYPTION_KEY: "b3".repeat(32) }), { code: "certificate_code_unreadable" });
  const parts = first.split(":");
  parts[2] = "A".repeat(22);
  assert.throws(() => decryptCertificateCode(parts.join(":"), 1, key), { code: "certificate_code_unreadable" });
});

test("certificate code storage fails closed without a valid encryption key", () => {
  const { code } = generateCertificateCode();
  for (const value of [undefined, "", "replace_me", "a2".repeat(31)]) {
    assert.throws(() => encryptCertificateCode(code, 1, { CERTIFICATE_CODE_ENCRYPTION_KEY: value }), { code: "certificate_code_key_missing" });
  }
});
