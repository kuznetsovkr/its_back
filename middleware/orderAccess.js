const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const TOKEN_VERSION = "v1";
const DEFAULT_TOKEN_TTL_HOURS = 24;
const MAX_TOKEN_TTL_HOURS = 168;

const getOrderAccessSecret = () => {
  if (process.env.ORDER_ACCESS_SECRET) return process.env.ORDER_ACCESS_SECRET;
  if (process.env.NODE_ENV !== "production") return process.env.JWT_SECRET || "";
  return "";
};

const getTokenTtlMs = () => {
  const configured = Number(process.env.ORDER_ACCESS_TOKEN_TTL_HOURS);
  const hours = Number.isFinite(configured) && configured > 0
    ? Math.min(configured, MAX_TOKEN_TTL_HOURS)
    : DEFAULT_TOKEN_TTL_HOURS;
  return hours * 60 * 60 * 1000;
};

const signPayload = (encodedPayload, secret) =>
  crypto
    .createHmac("sha256", secret)
    .update(`${TOKEN_VERSION}.${encodedPayload}`)
    .digest("base64url");

const createOrderAccessToken = (orderId) => {
  const normalizedOrderId = Number(orderId);
  const secret = getOrderAccessSecret();
  if (!secret) throw new Error("ORDER_ACCESS_SECRET is not configured");
  if (!Number.isInteger(normalizedOrderId) || normalizedOrderId < 1) {
    throw new Error("A valid order id is required");
  }

  const payload = Buffer.from(
    JSON.stringify({
      orderId: normalizedOrderId,
      expiresAt: Date.now() + getTokenTtlMs(),
      nonce: crypto.randomBytes(16).toString("base64url"),
    })
  ).toString("base64url");
  const signature = signPayload(payload, secret);
  return `${TOKEN_VERSION}.${payload}.${signature}`;
};

const verifyOrderAccessToken = (token) => {
  const secret = getOrderAccessSecret();
  if (!secret || typeof token !== "string" || token.length > 2048) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) return null;

  const expectedSignature = Buffer.from(signPayload(parts[1], secret), "base64url");
  let receivedSignature;
  try {
    receivedSignature = Buffer.from(parts[2], "base64url");
  } catch (_error) {
    return null;
  }

  if (
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const orderId = Number(payload.orderId);
    const expiresAt = Number(payload.expiresAt);
    if (!Number.isInteger(orderId) || orderId < 1 || !Number.isFinite(expiresAt)) return null;
    if (expiresAt <= Date.now()) return null;
    return { orderId, expiresAt };
  } catch (_error) {
    return null;
  }
};

const readAdminAccess = (req) => {
  const authHeader = String(req.header("Authorization") || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !process.env.JWT_SECRET) return null;

  const decoded = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ["HS256"] });
  if (decoded?.role !== "admin") return null;

  const configuredPhone = String(process.env.ADMIN_PHONE || "").replace(/\D/g, "");
  const tokenPhone = String(decoded.phone || "").replace(/\D/g, "");
  if (configuredPhone && configuredPhone !== tokenPhone) return null;

  return { kind: "admin", claims: decoded };
};

const requireOrderAccessConfigured = (_req, res, next) => {
  if (!getOrderAccessSecret()) {
    return res.status(503).json({ message: "Доступ к заказам не настроен" });
  }
  return next();
};

const requireOrderAccess = (req, res, next) => {
  const orderToken = String(req.header("X-Order-Access-Token") || "").trim();

  if (orderToken) {
    const access = verifyOrderAccessToken(orderToken);
    if (!access) {
      return res.status(401).json({ message: "Токен заказа недействителен или истёк" });
    }

    req.orderAccess = { kind: "order", ...access };
    return next();
  }

  try {
    const adminAccess = readAdminAccess(req);
    if (adminAccess) {
      req.orderAccess = adminAccess;
      req.user = adminAccess.claims;
      return next();
    }
  } catch (_error) {
    return res.status(401).json({ message: "Недействительная авторизация администратора" });
  }

  return res.status(401).json({ message: "Требуется токен заказа" });
};

const canAccessOrder = (req, orderOrId) => {
  if (req.orderAccess?.kind === "admin") return true;
  const orderId = Number(typeof orderOrId === "object" ? orderOrId?.id : orderOrId);
  return req.orderAccess?.kind === "order" && req.orderAccess.orderId === orderId;
};

module.exports = {
  canAccessOrder,
  createOrderAccessToken,
  requireOrderAccess,
  requireOrderAccessConfigured,
  verifyOrderAccessToken,
};
