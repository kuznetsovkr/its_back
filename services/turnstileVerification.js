const { randomUUID } = require("node:crypto");
const net = require("node:net");
const axios = require("axios");

const TURNSTILE_ACTION = "order_create";
const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
const TURNSTILE_TIMEOUT_MS = 5000;
const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);
const TURNSTILE_TEST_SECRET_KEYS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

class TurnstileVerificationError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = "TurnstileVerificationError";
    this.statusCode = statusCode;
    this.code = code;
    this.field = "turnstileToken";
  }
}

const isTurnstileEnabled = (env = process.env) =>
  String(env.TURNSTILE_ENABLED || "") === "1";

const parseExpectedHostnames = (value) => new Set(
  String(value || "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean)
);

const getPublicTurnstileConfig = (env = process.env) => {
  const enabled = isTurnstileEnabled(env);
  return {
    enabled,
    siteKey: enabled ? String(env.TURNSTILE_SITE_KEY || "").trim() : "",
    action: TURNSTILE_ACTION,
  };
};

const normalizeRemoteIp = (value) => {
  const candidate = String(value || "").trim();
  return net.isIP(candidate) ? candidate : "";
};

const invalidChallenge = () => new TurnstileVerificationError(
  "Не удалось подтвердить, что заказ отправляет человек. Пройдите проверку ещё раз.",
  400,
  "turnstile_failed"
);

const createTurnstileVerifier = ({
  env = process.env,
  post = (url, body, options) => axios.post(url, body, options),
  createIdempotencyKey = randomUUID,
} = {}) => async ({ token, remoteIp } = {}) => {
  if (!isTurnstileEnabled(env)) return { skipped: true };

  const secret = String(env.TURNSTILE_SECRET_KEY || "").trim();
  const expectedHostnames = parseExpectedHostnames(env.TURNSTILE_EXPECTED_HOSTNAMES);
  if (!secret || expectedHostnames.size === 0) {
    throw new TurnstileVerificationError(
      "Проверка защиты временно недоступна. Попробуйте ещё раз позже.",
      503,
      "turnstile_misconfigured"
    );
  }

  const responseToken = typeof token === "string" ? token.trim() : "";
  if (!responseToken || responseToken.length > TURNSTILE_TOKEN_MAX_LENGTH) {
    throw new TurnstileVerificationError(
      "Подтвердите, что заказ отправляет человек.",
      400,
      "turnstile_token_required"
    );
  }

  const payload = {
    secret,
    response: responseToken,
    idempotency_key: createIdempotencyKey(),
  };
  const trustedRemoteIp = normalizeRemoteIp(remoteIp);
  if (trustedRemoteIp) payload.remoteip = trustedRemoteIp;

  let verification;
  try {
    const response = await post(TURNSTILE_SITEVERIFY_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: TURNSTILE_TIMEOUT_MS,
      maxContentLength: 64 * 1024,
    });
    verification = response?.data;
  } catch (_error) {
    throw new TurnstileVerificationError(
      "Сервис защиты временно недоступен. Попробуйте отправить заказ ещё раз.",
      503,
      "turnstile_unavailable"
    );
  }

  const hostname = String(verification?.hostname || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    verification?.success !== true ||
    verification?.action !== TURNSTILE_ACTION ||
    !expectedHostnames.has(hostname)
  ) {
    throw invalidChallenge();
  }

  return {
    success: true,
    hostname,
    challengeTimestamp: verification.challenge_ts || null,
  };
};

const verifyTurnstileToken = createTurnstileVerifier();

module.exports = {
  TURNSTILE_ACTION,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET_KEYS,
  TURNSTILE_TEST_SITE_KEYS,
  TurnstileVerificationError,
  createTurnstileVerifier,
  getPublicTurnstileConfig,
  isTurnstileEnabled,
  parseExpectedHostnames,
  verifyTurnstileToken,
};
