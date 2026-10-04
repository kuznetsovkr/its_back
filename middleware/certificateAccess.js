const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { GiftCertificateError } = require("../lib/giftCertificateRules");
const AUDIENCE = "its-certificate-purchase";
const isCertificateId = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
const createCertificateAccessToken = (certificateId, env = process.env) => {
  if (!isCertificateId(certificateId) || !/^[a-f0-9]{64}$/i.test(env.CERTIFICATE_ACCESS_SECRET || "")) {
    throw new GiftCertificateError("Доступ к сертификатам не настроен", "certificate_access_unavailable", 503);
  }
  return jwt.sign({ certificateId, purpose: "certificate_purchase" }, env.CERTIFICATE_ACCESS_SECRET, {
    algorithm: "HS256", audience: AUDIENCE, issuer: "its", expiresIn: "7d",
    jwtid: crypto.randomBytes(16).toString("hex"),
  });
};
const verifyCertificateAccessToken = (token, env = process.env) => {
  if (typeof token !== "string" || token.length > 2048 || !/^[a-f0-9]{64}$/i.test(env.CERTIFICATE_ACCESS_SECRET || "")) return null;
  try {
    const payload = jwt.verify(token, env.CERTIFICATE_ACCESS_SECRET, { algorithms: ["HS256"], audience: AUDIENCE, issuer: "its" });
    return payload.purpose === "certificate_purchase" && isCertificateId(payload.certificateId) ? payload : null;
  } catch (_error) { return null; }
};
const requireCertificateAccess = (req, res, next) => {
  const id = Number(req.params.id);
  const access = verifyCertificateAccessToken(req.header("X-Certificate-Access-Token"));
  if (!isCertificateId(id) || !access || access.certificateId !== id) {
    return res.status(403).json({ message: "Нет доступа к этой покупке сертификата" });
  }
  req.certificateId = id;
  res.set("Cache-Control", "no-store");
  return next();
};
module.exports = { createCertificateAccessToken, requireCertificateAccess, verifyCertificateAccessToken };
