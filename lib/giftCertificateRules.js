const crypto = require("node:crypto");
const {
  RequestValidationError, assertAllowedKeys, ensurePlainObject, normalizeRuPhone, readString,
} = require("./requestValidation");

const CERTIFICATE_DENOMINATIONS = Object.freeze([
  1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000,
]);
const CERTIFICATE_STATUS = Object.freeze({
  PENDING: "pending", ACTIVE: "active", USED: "used", ANNULLED: "annulled",
});
const CERTIFICATE_STATUS_LABELS = Object.freeze({
  pending: "Ожидает оплаты", active: "Активен", used: "Использован", annulled: "Аннулирован",
});
const MAX_CERTIFICATE_KOPECKS = 2_000_000;

class GiftCertificateError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = "GiftCertificateError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const assertKopecks = (value, { allowZero = false } = {}) => {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647) {
    throw new GiftCertificateError("Некорректная сумма сертификата", "invalid_certificate_amount", 422);
  }
  return value;
};

const certificateExpiresAt = (paidAt) => {
  const date = new Date(paidAt);
  if (paidAt == null || !Number.isFinite(date.getTime())) {
    throw new GiftCertificateError("Некорректная дата оплаты", "invalid_certificate_date", 422);
  }
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  // A leap-day payment expires on February 28, rather than rolling into March.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date;
};

const getCertificateStatus = (certificate, now = new Date()) => {
  if (certificate.status === CERTIFICATE_STATUS.ANNULLED) return CERTIFICATE_STATUS.ANNULLED;
  if (certificate.status === CERTIFICATE_STATUS.PENDING && !certificate.paidAt) return CERTIFICATE_STATUS.PENDING;
  const expiry = new Date(certificate.expiresAt).getTime();
  if (!certificate.paidAt || !certificate.expiresAt || !Number.isFinite(expiry) || !Number.isFinite(now.getTime())) {
    throw new GiftCertificateError("Сертификат требует проверки", "invalid_certificate_state", 422);
  }
  if (expiry <= now.getTime()) return CERTIFICATE_STATUS.ANNULLED;
  return certificate.balanceKopecks === 0 ? CERTIFICATE_STATUS.USED : CERTIFICATE_STATUS.ACTIVE;
};

const normalizeCertificateCode = (value) => {
  if (typeof value !== "string" || value.length > 80) {
    throw new GiftCertificateError("Введите код сертификата из письма", "invalid_certificate_code", 400);
  }
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^ITS[A-F0-9]{32}$/.test(normalized)) {
    throw new GiftCertificateError("Введите код сертификата из письма", "invalid_certificate_code", 400);
  }
  return normalized;
};

const hashCertificateCode = (code) =>
  crypto.createHash("sha256").update(normalizeCertificateCode(code)).digest("hex");

const generateCertificateCode = () => {
  // 128 bits of entropy; the code is a transferable bearer credential, not an ID.
  const raw = crypto.randomBytes(16).toString("hex").toUpperCase();
  const code = `ITS-${raw.match(/.{4}/g).join("-")}`;
  return { code, codeHash: hashCertificateCode(code) };
};

const planCertificatePayment = ({ productKopecks, deliveryKopecks, availableKopecks }) => {
  assertKopecks(productKopecks);
  assertKopecks(deliveryKopecks, { allowZero: true });
  assertKopecks(availableKopecks, { allowZero: true });
  if (availableKopecks > MAX_CERTIFICATE_KOPECKS) {
    throw new GiftCertificateError("Некорректный баланс сертификата", "invalid_certificate_balance", 422);
  }
  const discountKopecks = Math.min(productKopecks, availableKopecks);
  const payableKopecks = assertKopecks(productKopecks - discountKopecks + deliveryKopecks, { allowZero: true });
  return { discountKopecks, productRemainderKopecks: productKopecks - discountKopecks, deliveryKopecks, payableKopecks };
};

const validateCertificatePurchaseInput = (body) => {
  ensurePlainObject(body, "body");
  assertAllowedKeys(body, new Set([
    "denomination", "fullName", "phone", "email", "preferredContact", "comment", "privacyConsent", "turnstileToken",
  ]), "покупке сертификата");
  if (!CERTIFICATE_DENOMINATIONS.includes(body.denomination)) {
    throw new RequestValidationError("Выберите доступный номинал сертификата", "denomination");
  }
  const fullName = readString(body.fullName, "fullName", { required: true, max: 200 });
  if (!/^[\p{L}][\p{L}\p{M}'’\- ]*$/u.test(fullName) || fullName.split(/\s+/).length < 2) {
    throw new RequestValidationError("Укажите фамилию и имя покупателя", "fullName");
  }
  const email = readString(body.email, "email", { required: true, max: 254 }).toLowerCase();
  const [localPart, domain = ""] = email.split("@");
  // A single unquoted mailbox only: commas/recipient lists must never make
  // a bearer code go to additional addresses when delivery is connected.
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)
    || localPart.length > 64 || localPart.startsWith(".") || localPart.endsWith(".")
    || email.includes("..") || domain.split(".").some((label) => label.length > 63)) {
    throw new RequestValidationError("Введите корректный e-mail для получения сертификата", "email");
  }
  if (body.privacyConsent !== true) {
    throw new RequestValidationError("Необходимо согласие на обработку персональных данных", "privacyConsent");
  }
  return {
    denomination: body.denomination, fullName: fullName.replace(/\s+/g, " "),
    phone: normalizeRuPhone(body.phone), email,
    preferredContact: readString(body.preferredContact, "preferredContact", { max: 80 }),
    comment: readString(body.comment, "comment", { max: 2500, multiline: true }),
    turnstileToken: readString(body.turnstileToken, "turnstileToken", { max: 2048 }),
  };
};

module.exports = {
  CERTIFICATE_DENOMINATIONS, CERTIFICATE_STATUS, CERTIFICATE_STATUS_LABELS, MAX_CERTIFICATE_KOPECKS,
  GiftCertificateError, assertKopecks, certificateExpiresAt, generateCertificateCode,
  getCertificateStatus, hashCertificateCode, normalizeCertificateCode, planCertificatePayment, validateCertificatePurchaseInput,
};
