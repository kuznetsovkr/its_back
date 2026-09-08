const cors = require("cors");

const CORS_ERROR_CODE = "CORS_ORIGIN_DENIED";
const DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

const normalizeOrigin = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.origin === "null") return null;
    return url.origin;
  } catch (_error) {
    return null;
  }
};

const getConfiguredOriginValues = (env) => [
  ...String(env.ALLOWED_PUBLIC_ORIGINS || "").split(","),
  String(env.PUBLIC_APP_URL || ""),
].map((value) => value.trim()).filter(Boolean);

const normalizeConfiguredOrigin = (value) => {
  const normalizedOrigin = normalizeOrigin(value);
  if (!normalizedOrigin) return null;

  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*")) {
    return null;
  }
  return normalizedOrigin;
};

const getAllowedOrigins = (env = process.env) => {
  const configuredValues = getConfiguredOriginValues(env);
  const invalidValues = configuredValues.filter((value) => !normalizeConfiguredOrigin(value));
  if (invalidValues.length > 0) {
    throw new Error(`Invalid CORS origin configuration: ${invalidValues.join(", ")}`);
  }

  const origins = new Set(configuredValues.map(normalizeConfiguredOrigin));
  if (env.NODE_ENV !== "production") {
    DEVELOPMENT_ORIGINS.forEach((origin) => origins.add(origin));
  }

  if (env.NODE_ENV === "production" && origins.size === 0) {
    throw new Error(
      "CORS allowlist is empty: set ALLOWED_PUBLIC_ORIGINS or PUBLIC_APP_URL"
    );
  }

  return origins;
};

const createCorsMiddleware = (env = process.env) => {
  const allowedOrigins = getAllowedOrigins(env);

  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, false);

      const normalizedOrigin = normalizeOrigin(origin);
      if (normalizedOrigin && allowedOrigins.has(normalizedOrigin)) {
        return callback(null, true);
      }

      const error = new Error("Источник запроса не разрешён");
      error.code = CORS_ERROR_CODE;
      error.statusCode = 403;
      return callback(error);
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Order-Access-Token"],
    exposedHeaders: [
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After",
      "Server-Timing",
      "X-Current-Page",
      "X-Service-Version",
      "X-Total-Elements",
      "X-Total-Pages",
    ],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
};

const handleCorsError = (error, _req, res, next) => {
  if (error?.code !== CORS_ERROR_CODE) return next(error);
  return res.status(403).json({ message: "Источник запроса не разрешён" });
};

module.exports = {
  createCorsMiddleware,
  getAllowedOrigins,
  handleCorsError,
  normalizeOrigin,
};
