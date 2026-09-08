const { createClient } = require("redis");

const REDIS_CONSUME_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])

if count == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end

return { count, ttl }
`;

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveRateLimitConfig = (env = process.env) => {
  const mode = String(
    env.RATE_LIMIT_STORE || (env.NODE_ENV === "production" ? "redis" : "memory")
  ).trim().toLowerCase();

  if (!["memory", "redis"].includes(mode)) {
    throw new Error("RATE_LIMIT_STORE must be either redis or memory");
  }
  if (env.NODE_ENV === "production" && mode !== "redis") {
    throw new Error("Production rate limiting requires RATE_LIMIT_STORE=redis");
  }

  const keyPrefix = String(env.RATE_LIMIT_REDIS_PREFIX || "its:rate-limit").trim();
  if (!keyPrefix || !/^[a-zA-Z0-9:_-]+$/.test(keyPrefix)) {
    throw new Error("RATE_LIMIT_REDIS_PREFIX contains unsupported characters");
  }

  if (mode === "memory") return { mode, keyPrefix };

  const redisUrl = String(env.REDIS_URL || "").trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(redisUrl);
  } catch (_error) {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
  }
  if (!["redis:", "rediss:"].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL");
  }

  return {
    mode,
    keyPrefix,
    redisUrl,
    connectTimeoutMs: parsePositiveInteger(env.REDIS_CONNECT_TIMEOUT_MS, 5_000),
  };
};

class MemoryRateLimitStore {
  constructor({ now = Date.now } = {}) {
    this.entries = new Map();
    this.lastCleanup = 0;
    this.now = now;
  }

  async consume(key, windowMs, maxEntries = 50_000) {
    const now = this.now();
    if (now - this.lastCleanup > windowMs) {
      this.lastCleanup = now;
      for (const [entryKey, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(entryKey);
      }
    }

    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!this.entries.has(key) && this.entries.size >= maxEntries) {
        this.entries.delete(this.entries.keys().next().value);
      }
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }

    entry.count += 1;
    return {
      count: entry.count,
      resetMs: Math.max(1, entry.resetAt - now),
    };
  }
}

class RedisRateLimitStore {
  constructor(client, keyPrefix) {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  async consume(key, windowMs) {
    if (!this.client.isReady) {
      throw new Error("Redis client is not ready");
    }

    const result = await this.client.eval(REDIS_CONSUME_SCRIPT, {
      keys: [`${this.keyPrefix}:${key}`],
      arguments: [String(windowMs)],
    });
    const count = Number(result?.[0]);
    const resetMs = Number(result?.[1]);
    if (!Number.isInteger(count) || count < 1 || !Number.isFinite(resetMs) || resetMs < 1) {
      throw new Error("Redis returned an invalid rate-limit result");
    }

    return { count, resetMs };
  }
}

let activeClient = null;
let activeStore = new MemoryRateLimitStore();
let activeMode = "memory";

const closeRateLimitStore = async () => {
  if (activeClient) {
    if (activeClient.isOpen) activeClient.destroy();
    activeClient = null;
  }
  activeStore = new MemoryRateLimitStore();
  activeMode = "memory";
};

const initializeRateLimitStore = async ({
  env = process.env,
  clientFactory = createClient,
} = {}) => {
  const config = resolveRateLimitConfig(env);
  await closeRateLimitStore();

  if (config.mode === "memory") {
    return { mode: activeMode };
  }

  const client = clientFactory({
    url: config.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: config.connectTimeoutMs,
      reconnectStrategy(retries) {
        if (retries >= 3) return new Error("Redis reconnect limit reached");
        return Math.min(250 * (2 ** retries), 2_000);
      },
    },
  });
  client.on("error", (error) => {
    console.error("[redis] Client error:", error.message);
  });

  try {
    await client.connect();
    await client.ping();
  } catch (error) {
    if (client.isOpen) client.destroy();
    throw new Error(`Cannot connect to the rate-limit Redis store: ${error.message}`);
  }

  activeClient = client;
  activeStore = new RedisRateLimitStore(client, config.keyPrefix);
  activeMode = "redis";
  return { mode: activeMode };
};

const getRateLimitStore = () => activeStore;
const getRateLimitStoreMode = () => activeMode;

module.exports = {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  closeRateLimitStore,
  getRateLimitStore,
  getRateLimitStoreMode,
  initializeRateLimitStore,
  resolveRateLimitConfig,
};
