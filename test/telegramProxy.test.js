const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createTelegramBotOptions,
  getTelegramAxiosRequestConfig,
  getTelegramProxyConfig,
} = require("../services/telegramProxy");

test("Telegram proxy remains disabled without a URL", () => {
  assert.equal(getTelegramProxyConfig({}), null);
  assert.deepEqual(getTelegramAxiosRequestConfig({}), { proxy: false });
  assert.deepEqual(createTelegramBotOptions({}), {});
});

test("Telegram proxy parses separate credentials for Axios", () => {
  const env = {
    TELEGRAM_PROXY_URL: "http://proxy.example:3128",
    TELEGRAM_PROXY_USERNAME: "telegram-user",
    TELEGRAM_PROXY_PASSWORD: "telegram-password",
  };

  assert.deepEqual(getTelegramAxiosRequestConfig(env), {
    proxy: {
      protocol: "http",
      host: "proxy.example",
      port: 3128,
      auth: {
        username: "telegram-user",
        password: "telegram-password",
      },
    },
  });
});

test("Telegram bot fetch uses a scoped proxy dispatcher", async () => {
  const createdAgents = [];
  const fetchCalls = [];
  class FakeProxyAgent {
    constructor(options) {
      this.options = options;
      createdAgents.push(this);
    }
  }
  const fetchImpl = async (input, init) => {
    fetchCalls.push({ input, init });
    return { ok: true };
  };

  const options = createTelegramBotOptions(
    {
      TELEGRAM_PROXY_URL: "https://encoded%20user:encoded%2Fpassword@proxy.example:8443",
    },
    { ProxyAgentClass: FakeProxyAgent, fetchImpl }
  );

  assert.equal(options.maxRetries, 4);
  assert.equal(options.retryBackoffMs, 500);
  assert.equal(createdAgents.length, 1);
  assert.equal(createdAgents[0].options.uri, "https://proxy.example:8443");
  assert.equal(
    Buffer.from(createdAgents[0].options.token.slice("Basic ".length), "base64").toString("utf8"),
    "encoded user:encoded/password"
  );

  await options.fetch("https://api.telegram.org/test", { method: "POST" });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.dispatcher, createdAgents[0]);
  assert.equal(fetchCalls[0].init.method, "POST");
});

test("Telegram proxy rejects unsafe or incomplete configuration", () => {
  assert.throws(
    () => getTelegramProxyConfig({ TELEGRAM_PROXY_USERNAME: "orphan" }),
    /TELEGRAM_PROXY_URL is required/
  );
  assert.throws(
    () => getTelegramProxyConfig({ TELEGRAM_PROXY_URL: "socks5://proxy.example:1080" }),
    /must use http:\/\/ or https:\/\//
  );
  assert.throws(
    () => getTelegramProxyConfig({ TELEGRAM_PROXY_URL: "http://proxy.example/path" }),
    /must not include a path/
  );
  assert.throws(
    () => getTelegramProxyConfig({
      TELEGRAM_PROXY_URL: "http://proxy.example:3128",
      TELEGRAM_PROXY_USERNAME: "missing-password",
    }),
    /username and password must be configured together/
  );
  assert.throws(
    () => getTelegramProxyConfig({
      TELEGRAM_PROXY_URL: "http://embedded:secret@proxy.example:3128",
      TELEGRAM_PROXY_USERNAME: "duplicate",
      TELEGRAM_PROXY_PASSWORD: "duplicate",
    }),
    /either in the URL or separate variables/
  );
});
