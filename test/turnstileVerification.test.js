const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  TURNSTILE_ACTION,
  TURNSTILE_SITEVERIFY_URL,
  TurnstileVerificationError,
  createTurnstileVerifier,
  getPublicTurnstileConfig,
} = require("../services/turnstileVerification");

const enabledEnv = () => ({
  TURNSTILE_ENABLED: "1",
  TURNSTILE_SITE_KEY: "0x4AAAAAAA-public-site-key",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-private-secret-key",
  TURNSTILE_EXPECTED_HOSTNAMES: "stage.its-site.ru,its-site.ru",
});

test("disabled Turnstile does not call Cloudflare", async () => {
  let called = false;
  const verify = createTurnstileVerifier({
    env: { TURNSTILE_ENABLED: "0" },
    post: async () => {
      called = true;
    },
  });

  assert.deepEqual(await verify({}), { skipped: true });
  assert.equal(called, false);
});

test("Turnstile validates token, action, hostname and client IP", async () => {
  let request;
  const verify = createTurnstileVerifier({
    env: enabledEnv(),
    createIdempotencyKey: () => "1a810c76-2a60-4ac5-8753-938c066e1bb8",
    post: async (url, body, options) => {
      request = { url, body, options };
      return {
        data: {
          success: true,
          action: TURNSTILE_ACTION,
          hostname: "stage.its-site.ru",
          challenge_ts: "2026-09-13T07:00:00.000Z",
        },
      };
    },
  });

  const result = await verify({ token: "valid-token", remoteIp: "203.0.113.10" });

  assert.equal(result.success, true);
  assert.equal(result.hostname, "stage.its-site.ru");
  assert.equal(request.url, TURNSTILE_SITEVERIFY_URL);
  assert.equal(request.body.secret, enabledEnv().TURNSTILE_SECRET_KEY);
  assert.equal(request.body.response, "valid-token");
  assert.equal(request.body.remoteip, "203.0.113.10");
  assert.equal(request.body.idempotency_key, "1a810c76-2a60-4ac5-8753-938c066e1bb8");
  assert.equal(request.options.timeout, 5000);
});

test("Turnstile rejects a missing, failed or replayed challenge", async () => {
  const missingTokenVerifier = createTurnstileVerifier({
    env: enabledEnv(),
    post: async () => assert.fail("Cloudflare must not be called without a token"),
  });
  await assert.rejects(
    missingTokenVerifier({ token: "" }),
    (error) => error instanceof TurnstileVerificationError &&
      error.statusCode === 400 &&
      error.code === "turnstile_token_required"
  );

  const failedVerifier = createTurnstileVerifier({
    env: enabledEnv(),
    post: async () => ({
      data: { success: false, "error-codes": ["timeout-or-duplicate"] },
    }),
  });
  await assert.rejects(
    failedVerifier({ token: "spent-token" }),
    (error) => error.statusCode === 400 && error.code === "turnstile_failed"
  );
});

test("Turnstile rejects an unexpected action or hostname", async () => {
  for (const response of [
    { success: true, action: "admin_login", hostname: "stage.its-site.ru" },
    { success: true, action: TURNSTILE_ACTION, hostname: "attacker.example" },
  ]) {
    const verify = createTurnstileVerifier({
      env: enabledEnv(),
      post: async () => ({ data: response }),
    });
    await assert.rejects(
      verify({ token: "valid-token" }),
      (error) => error.statusCode === 400 && error.code === "turnstile_failed"
    );
  }
});

test("Turnstile fails closed when Siteverify is unavailable", async () => {
  const verify = createTurnstileVerifier({
    env: enabledEnv(),
    post: async () => {
      throw new Error("network timeout");
    },
  });

  await assert.rejects(
    verify({ token: "valid-token" }),
    (error) => error.statusCode === 503 && error.code === "turnstile_unavailable"
  );
});

test("public Turnstile config never exposes the secret", () => {
  const config = getPublicTurnstileConfig(enabledEnv());
  assert.deepEqual(config, {
    enabled: true,
    siteKey: enabledEnv().TURNSTILE_SITE_KEY,
    action: TURNSTILE_ACTION,
  });
  assert.equal(JSON.stringify(config).includes(enabledEnv().TURNSTILE_SECRET_KEY), false);
});
