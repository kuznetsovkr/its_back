const { GiftCertificateError } = require("../lib/giftCertificateRules");

const isCertificatePurchaseEnabled = (env = process.env) => env.CERTIFICATE_PURCHASE_ENABLED === "1";
const getCertificateMailConfig = (env = process.env) => {
  const port = Number(env.CERTIFICATE_SMTP_PORT);
  const from = String(env.CERTIFICATE_MAIL_FROM || "").trim();
  const host = String(env.CERTIFICATE_SMTP_HOST || "").trim();
  if (!/^[a-z0-9.-]+$/i.test(host) || ![465, 587].includes(port)
    || !/^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(from)
    || !env.CERTIFICATE_SMTP_USER || !env.CERTIFICATE_SMTP_PASSWORD) return null;
  return {
    from, host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: env.CERTIFICATE_SMTP_USER, pass: env.CERTIFICATE_SMTP_PASSWORD },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false, tls: { minVersion: "TLSv1.2" },
  };
};
const hasCertificateSecrets = (env = process.env) => {
  const key = String(env.CERTIFICATE_CODE_ENCRYPTION_KEY || "");
  const secret = String(env.CERTIFICATE_ACCESS_SECRET || "");
  return /^[a-f0-9]{64}$/i.test(key) && /^[a-f0-9]{64}$/i.test(secret)
    && ![env.JWT_SECRET, env.ORDER_ACCESS_SECRET].some((value) => value && value.toLowerCase() === key.toLowerCase())
    && ![key, env.JWT_SECRET, env.ORDER_ACCESS_SECRET].some((value) => value && value.toLowerCase() === secret.toLowerCase());
};
const hasCertificatePaymentConfig = (env) => {
  try {
    const url = new URL(env.PAYKEEPER_BASE_URL);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && Boolean(env.PAYKEEPER_LOGIN && env.PAYKEEPER_PASSWORD) && String(env.PAYKEEPER_SECRET_SEED || "").length >= 16;
  } catch (_error) { return false; }
};
const isCertificateCheckoutConfigured = (env = process.env) => isCertificatePurchaseEnabled(env)
  && hasCertificateSecrets(env) && hasCertificatePaymentConfig(env) && Boolean(getCertificateMailConfig(env));
const assertCertificateCheckoutConfigured = (env = process.env) => {
  if (!isCertificateCheckoutConfigured(env)) {
    throw new GiftCertificateError("Покупка сертификатов пока недоступна: настраиваем доставку на email", "certificate_checkout_unavailable", 503);
  }
};
module.exports = {
  assertCertificateCheckoutConfigured, getCertificateMailConfig, hasCertificateSecrets,
  isCertificateCheckoutConfigured, isCertificatePurchaseEnabled,
};
