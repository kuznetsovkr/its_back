const crypto = require("node:crypto");
const { RequestValidationError } = require("./requestValidation");
const TTL = 30 * 60_000;
const sign = body => {
  const secret = process.env.ORDER_ACCESS_SECRET || (process.env.NODE_ENV !== "production" ? process.env.JWT_SECRET : "");
  if (!secret) throw new RequestValidationError("Расчёт доставки временно недоступен", "shippingContext");
  return crypto.createHmac("sha256", secret).update(`its:cdek-quote:v1:${body}`).digest("base64url");
};
const issueCdekQuoteContext = ({ packages, declaredValue }, now = Date.now()) => {
  const body = Buffer.from(JSON.stringify({ packages, declaredValue, expiresAt: now + TTL })).toString("base64url");
  return `cq1.${body}.${sign(body)}`;
};
const verifyCdekQuoteContext = (token, now = Date.now()) => {
  if (typeof token !== "string" || token.length > 2048) throw new RequestValidationError("Обновите карту для расчёта доставки", "shippingContext");
  const [version, body, signature, extra] = token.split(".");
  const expected = Buffer.from(sign(body || "")); const received = Buffer.from(signature || "");
  if (version !== "cq1" || extra || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw new RequestValidationError("Обновите карту для расчёта доставки", "shippingContext");
  try {
    const context = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Number.isFinite(context.expiresAt) || context.expiresAt <= now || context.expiresAt > now + TTL || !Array.isArray(context.packages) || context.packages.length !== 1
      || !(context.declaredValue === null || Number.isSafeInteger(context.declaredValue) && context.declaredValue > 0)) throw new Error();
    return context;
  } catch { throw new RequestValidationError("Срок расчёта истёк. Откройте карту заново", "shippingContext"); }
};
module.exports = { issueCdekQuoteContext, verifyCdekQuoteContext };
