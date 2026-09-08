const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { afterEach, test } = require("node:test");
const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimit");
const {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  closeRateLimitStore,
  getRateLimitStoreMode,
  initializeRateLimitStore,
  resolveRateLimitConfig,
} = require("../services/rateLimitStore");

afterEach(() => closeRateLimitStore());

test("memory rate-limit store keeps a fixed window", async () => {
  let now = 1_000;
  const store = new MemoryRateLimitStore({ now: () => now });

  assert.deepEqual(await store.consume("order:test", 60_000), {
    count: 1,
    resetMs: 60_000,
  });
  now += 15_000;
  assert.deepEqual(await store.consume("order:test", 60_000), {
    count: 2,
    resetMs: 45_000,
  });
  now += 45_000;
  assert.deepEqual(await store.consume("order:test", 60_000), {
    count: 1,
    resetMs: 60_000,
  });
});

test("Redis rate-limit store uses one atomic script with a TTL", async () => {
  let invocation;
  const client = {
    isReady: true,
    eval: async (script, options) => {
      invocation = { script, options };
      return [3, 42_500];
    },
  };
  const store = new RedisRateLimitStore(client, "its:test:rate-limit");

  assert.deepEqual(await store.consume("orders:hashed-identity", 60_000), {
    count: 3,
    resetMs: 42_500,
  });
  assert.match(invocation.script, /INCR/);
  assert.match(invocation.script, /PEXPIRE/);
  assert.deepEqual(invocation.options, {
    keys: ["its:test:rate-limit:orders:hashed-identity"],
    arguments: ["60000"],
  });
});

test("production configuration requires a valid Redis connection URL", () => {
  assert.throws(
    () => resolveRateLimitConfig({ NODE_ENV: "production", RATE_LIMIT_STORE: "memory" }),
    /requires RATE_LIMIT_STORE=redis/
  );
  assert.throws(
    () => resolveRateLimitConfig({ NODE_ENV: "production", RATE_LIMIT_STORE: "redis" }),
    /REDIS_URL/
  );
  assert.throws(
    () =>
      resolveRateLimitConfig({
        NODE_ENV: "production",
        RATE_LIMIT_STORE: "redis",
        REDIS_URL: "https://redis.example",
      }),
    /REDIS_URL/
  );

  const config = resolveRateLimitConfig({
    NODE_ENV: "production",
    RATE_LIMIT_STORE: "redis",
    REDIS_URL: "rediss://default:secret@redis.example:6380/0",
    RATE_LIMIT_REDIS_PREFIX: "its:production:rate-limit",
  });
  assert.equal(config.mode, "redis");
  assert.equal(config.keyPrefix, "its:production:rate-limit");
});

test("initialization connects and verifies Redis before enabling the store", async () => {
  class FakeRedisClient extends EventEmitter {
    constructor() {
      super();
      this.isOpen = false;
      this.isReady = false;
      this.destroyed = false;
    }

    async connect() {
      this.isOpen = true;
      this.isReady = true;
    }

    async ping() {
      return "PONG";
    }

    destroy() {
      this.isOpen = false;
      this.isReady = false;
      this.destroyed = true;
    }
  }

  const client = new FakeRedisClient();
  let clientOptions;
  const result = await initializeRateLimitStore({
    env: {
      NODE_ENV: "production",
      RATE_LIMIT_STORE: "redis",
      REDIS_URL: "redis://redis.internal:6379/0",
    },
    clientFactory: (options) => {
      clientOptions = options;
      return client;
    },
  });

  assert.equal(result.mode, "redis");
  assert.equal(getRateLimitStoreMode(), "redis");
  assert.equal(clientOptions.url, "redis://redis.internal:6379/0");

  await closeRateLimitStore();
  assert.equal(client.destroyed, true);
  assert.equal(getRateLimitStoreMode(), "memory");
});

test("rate limiter fails closed when the shared store is unavailable", async (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });

  const app = express();
  app.get(
    "/limited",
    createRateLimiter({
      windowMs: 60_000,
      max: 10,
      keyPrefix: "unavailable-store-test",
      message: "Limited",
      store: {
        consume: async () => {
          throw new Error("Redis unavailable");
        },
      },
    }),
    (_req, res) => res.json({ ok: true })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/limited`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), {
    message: "Сервис временно недоступен. Повторите попытку позднее",
  });
});
