const crypto = require("node:crypto");
const { GiftCertificateError, normalizeCertificateCode } = require("./giftCertificateRules");

const readKey = (env) => {
  const value = String(env.CERTIFICATE_CODE_ENCRYPTION_KEY || "");
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new GiftCertificateError("Выдача сертификатов ещё не настроена", "certificate_code_key_missing", 503);
  }
  return Buffer.from(value, "hex");
};

const context = (certificateId) => {
  if (!Number.isSafeInteger(certificateId) || certificateId < 1) {
    throw new GiftCertificateError("Некорректный сертификат", "invalid_certificate_id", 422);
  }
  return Buffer.from(`its:gift-certificate:${certificateId}:v1`);
};

const encryptCertificateCode = (code, certificateId, env = process.env) => {
  normalizeCertificateCode(code);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", readKey(env), iv);
  cipher.setAAD(context(certificateId));
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
};

const decryptCertificateCode = (envelope, certificateId, env = process.env) => {
  const key = readKey(env);
  try {
    if (typeof envelope !== "string" || envelope.length > 512) throw new Error("Invalid envelope");
    const parts = envelope.split(":");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
      throw new Error("Invalid envelope");
    }
    const [iv, tag, ciphertext] = parts.slice(1).map((part) => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid envelope");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(context(certificateId));
    decipher.setAuthTag(tag);
    const code = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    normalizeCertificateCode(code);
    return code;
  } catch (_error) {
    throw new GiftCertificateError("Не удалось прочитать код сертификата", "certificate_code_unreadable", 503);
  }
};

module.exports = { encryptCertificateCode, decryptCertificateCode };
