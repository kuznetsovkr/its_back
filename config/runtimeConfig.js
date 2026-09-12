class RuntimeConfigError extends Error {
  constructor(errors) {
    super(`Invalid production configuration: ${errors.join("; ")}`);
    this.name = "RuntimeConfigError";
    this.code = "INVALID_RUNTIME_CONFIG";
    this.errors = errors;
  }
}

const byteLength = (value) => Buffer.byteLength(String(value || ""));

const isPositiveInteger = (value, { max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max;
};

const isHttpsOrigin = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash;
  } catch (_error) {
    return false;
  }
};

const isHttpsUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch (_error) {
    return false;
  }
};

const validateRuntimeConfig = (env = process.env) => {
  if (env.NODE_ENV !== "production") {
    return { validated: false, mode: env.NODE_ENV || "development" };
  }

  const errors = [];
  const requireValue = (name) => {
    if (!String(env[name] || "").trim()) errors.push(`${name} is required`);
  };

  [
    "DB_HOST",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "FRONTEND_BUILD_DIR",
    "UPLOAD_DIR",
    "ADMIN_PHONE",
    "ADMIN_PASSWORD",
    "JWT_SECRET",
    "ORDER_ACCESS_SECRET",
    "CDEK_CLIENT_ID",
    "CDEK_CLIENT_SECRET",
    "PAYKEEPER_BASE_URL",
    "PAYKEEPER_LOGIN",
    "PAYKEEPER_PASSWORD",
    "PAYKEEPER_SECRET_SEED",
  ].forEach(requireValue);

  if (!isHttpsOrigin(env.PUBLIC_APP_URL)) {
    errors.push("PUBLIC_APP_URL must be an HTTPS origin without a path");
  }
  if (env.CDEK_BASE_URL && !isHttpsUrl(env.CDEK_BASE_URL)) {
    errors.push("CDEK_BASE_URL must be an HTTPS URL");
  }
  if (!isHttpsUrl(env.PAYKEEPER_BASE_URL)) {
    errors.push("PAYKEEPER_BASE_URL must be an HTTPS URL");
  }

  if (byteLength(env.JWT_SECRET) < 32) {
    errors.push("JWT_SECRET must contain at least 32 bytes");
  }
  if (byteLength(env.ORDER_ACCESS_SECRET) < 32) {
    errors.push("ORDER_ACCESS_SECRET must contain at least 32 bytes");
  }
  if (
    env.JWT_SECRET &&
    env.ORDER_ACCESS_SECRET &&
    String(env.JWT_SECRET) === String(env.ORDER_ACCESS_SECRET)
  ) {
    errors.push("JWT_SECRET and ORDER_ACCESS_SECRET must be different");
  }
  if (byteLength(env.ADMIN_PASSWORD) < 12) {
    errors.push("ADMIN_PASSWORD must contain at least 12 bytes");
  }
  if (byteLength(env.PAYKEEPER_SECRET_SEED) < 16) {
    errors.push("PAYKEEPER_SECRET_SEED must contain at least 16 bytes");
  }

  const adminPhone = String(env.ADMIN_PHONE || "").replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(adminPhone)) {
    errors.push("ADMIN_PHONE must contain 10 or 11 digits");
  }

  if (env.DB_PORT && !isPositiveInteger(env.DB_PORT, { max: 65535 })) {
    errors.push("DB_PORT must be a valid TCP port");
  }
  if (
    env.ORDER_ACCESS_TOKEN_TTL_HOURS &&
    !isPositiveInteger(env.ORDER_ACCESS_TOKEN_TTL_HOURS, { max: 24 * 7 })
  ) {
    errors.push("ORDER_ACCESS_TOKEN_TTL_HOURS must be between 1 and 168");
  }
  if (
    env.ORDER_RESERVATION_TTL_MINUTES &&
    !isPositiveInteger(env.ORDER_RESERVATION_TTL_MINUTES, { max: 24 * 60 })
  ) {
    errors.push("ORDER_RESERVATION_TTL_MINUTES must be between 1 and 1440");
  }

  for (const name of [
    "ENABLE_CDEK_RETRY_CRON",
    "ENABLE_RESERVATION_CRON",
    "ENABLE_TELEGRAM_ORDER_CHANNEL",
    "ENABLE_TELEGRAM_LOW_STOCK_CHANNEL",
    "ENABLE_LOW_STOCK_CRON",
    "ENABLE_SQL_LOGGING",
    "ENABLE_STARTUP_WARNINGS",
    "TRUST_PROXY",
  ]) {
    if (env[name] !== undefined && !["0", "1"].includes(String(env[name]))) {
      errors.push(`${name} must be 0 or 1`);
    }
  }

  for (const name of ["ENABLE_RESERVATION_CRON", "ENABLE_CDEK_RETRY_CRON"]) {
    if (String(env[name] || "") !== "1") {
      errors.push(`${name} must be enabled in production`);
    }
  }

  if (errors.length) throw new RuntimeConfigError(errors);
  return { validated: true, mode: "production" };
};

module.exports = {
  RuntimeConfigError,
  isHttpsOrigin,
  isHttpsUrl,
  validateRuntimeConfig,
};
