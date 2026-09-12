const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  RuntimeConfigError,
  validateRuntimeConfig,
} = require("../config/runtimeConfig");

const validProductionEnv = () => ({
  NODE_ENV: "production",
  PUBLIC_APP_URL: "https://stage.example.com",
  FRONTEND_BUILD_DIR: "/srv/example/current/frontend",
  UPLOAD_DIR: "/srv/example/shared/uploads",
  DB_HOST: "127.0.0.1",
  DB_PORT: "5432",
  DB_NAME: "example",
  DB_USER: "example",
  DB_PASSWORD: "database-password",
  ADMIN_PHONE: "+7 999 123-45-67",
  ADMIN_PASSWORD: "strong-admin-password",
  JWT_SECRET: "jwt-secret-that-is-longer-than-32-bytes",
  ORDER_ACCESS_SECRET: "order-secret-that-is-different-and-long",
  ORDER_ACCESS_TOKEN_TTL_HOURS: "24",
  ORDER_RESERVATION_TTL_MINUTES: "30",
  CDEK_BASE_URL: "https://api.cdek.ru/v2",
  CDEK_CLIENT_ID: "client-id",
  CDEK_CLIENT_SECRET: "client-secret",
  PAYKEEPER_BASE_URL: "https://merchant.server.paykeeper.ru",
  PAYKEEPER_LOGIN: "api-user",
  PAYKEEPER_PASSWORD: "api-password",
  PAYKEEPER_SECRET_SEED: "payment-secret-seed",
  ENABLE_CDEK_RETRY_CRON: "1",
  ENABLE_RESERVATION_CRON: "1",
  ENABLE_TELEGRAM_ORDER_CHANNEL: "0",
  ENABLE_TELEGRAM_LOW_STOCK_CHANNEL: "0",
  ENABLE_LOW_STOCK_CRON: "0",
  ENABLE_SQL_LOGGING: "0",
  ENABLE_STARTUP_WARNINGS: "1",
  TRUST_PROXY: "1",
});

test("development startup does not require production integrations", () => {
  assert.deepEqual(validateRuntimeConfig({ NODE_ENV: "development" }), {
    validated: false,
    mode: "development",
  });
});

test("valid production configuration passes the startup gate", () => {
  assert.deepEqual(validateRuntimeConfig(validProductionEnv()), {
    validated: true,
    mode: "production",
  });
});

test("production startup rejects missing and unsafe critical settings", () => {
  const env = validProductionEnv();
  env.PUBLIC_APP_URL = "http://stage.example.com/path";
  env.JWT_SECRET = "short";
  env.ORDER_ACCESS_SECRET = "short";
  env.ADMIN_PASSWORD = "weak";
  env.PAYKEEPER_SECRET_SEED = "tiny";
  env.CDEK_CLIENT_SECRET = "";
  env.ENABLE_CDEK_RETRY_CRON = "yes";

  assert.throws(
    () => validateRuntimeConfig(env),
    (error) => {
      assert.equal(error instanceof RuntimeConfigError, true);
      assert.equal(error.code, "INVALID_RUNTIME_CONFIG");
      assert.match(error.message, /PUBLIC_APP_URL/);
      assert.match(error.message, /JWT_SECRET/);
      assert.match(error.message, /ORDER_ACCESS_SECRET/);
      assert.match(error.message, /ADMIN_PASSWORD/);
      assert.match(error.message, /PAYKEEPER_SECRET_SEED/);
      assert.match(error.message, /CDEK_CLIENT_SECRET/);
      assert.match(error.message, /ENABLE_CDEK_RETRY_CRON/);
      return true;
    }
  );
});

test("admin and guest-order JWT secrets must be independent", () => {
  const env = validProductionEnv();
  env.ORDER_ACCESS_SECRET = env.JWT_SECRET;

  assert.throws(
    () => validateRuntimeConfig(env),
    /JWT_SECRET and ORDER_ACCESS_SECRET must be different/
  );
});

test("critical reservation and shipment workers cannot be disabled in production", () => {
  const env = validProductionEnv();
  env.ENABLE_RESERVATION_CRON = "0";
  env.ENABLE_CDEK_RETRY_CRON = "0";

  assert.throws(
    () => validateRuntimeConfig(env),
    (error) => {
      assert.match(error.message, /ENABLE_RESERVATION_CRON must be enabled/);
      assert.match(error.message, /ENABLE_CDEK_RETRY_CRON must be enabled/);
      return true;
    }
  );
});
