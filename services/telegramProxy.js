const { ProxyAgent } = require("undici");

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:"]);

const clean = (value) => String(value || "").trim();

const decodeCredential = (value, fieldName) => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Telegram proxy ${fieldName} is not valid URL encoding`);
  }
};

const getTelegramProxyConfig = (env = process.env) => {
  const rawUrl = clean(env.TELEGRAM_PROXY_URL);
  const configuredUsername = clean(env.TELEGRAM_PROXY_USERNAME);
  const configuredPassword = clean(env.TELEGRAM_PROXY_PASSWORD);

  if (!rawUrl) {
    if (configuredUsername || configuredPassword) {
      throw new Error("TELEGRAM_PROXY_URL is required when proxy credentials are configured");
    }
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("TELEGRAM_PROXY_URL must be a valid absolute URL");
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("TELEGRAM_PROXY_URL must use http:// or https://");
  }
  if (!parsedUrl.hostname) {
    throw new Error("TELEGRAM_PROXY_URL must include a hostname");
  }
  if ((parsedUrl.pathname && parsedUrl.pathname !== "/") || parsedUrl.search || parsedUrl.hash) {
    throw new Error("TELEGRAM_PROXY_URL must not include a path, query or fragment");
  }

  const embeddedUsername = decodeCredential(parsedUrl.username, "username");
  const embeddedPassword = decodeCredential(parsedUrl.password, "password");
  if ((embeddedUsername || embeddedPassword) && (configuredUsername || configuredPassword)) {
    throw new Error("Configure Telegram proxy credentials either in the URL or separate variables, not both");
  }

  const username = configuredUsername || embeddedUsername;
  const password = configuredPassword || embeddedPassword;
  if (Boolean(username) !== Boolean(password)) {
    throw new Error("Telegram proxy username and password must be configured together");
  }

  parsedUrl.username = "";
  parsedUrl.password = "";

  return {
    uri: parsedUrl.origin,
    protocol: parsedUrl.protocol.slice(0, -1),
    hostname: parsedUrl.hostname,
    port: Number(parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80)),
    username,
    password,
  };
};

const getTelegramAxiosRequestConfig = (env = process.env) => {
  const config = getTelegramProxyConfig(env);
  if (!config) return { proxy: false };

  return {
    proxy: {
      protocol: config.protocol,
      host: config.hostname,
      port: config.port,
      ...(config.username
        ? { auth: { username: config.username, password: config.password } }
        : {}),
    },
  };
};

const createTelegramBotOptions = (
  env = process.env,
  { ProxyAgentClass = ProxyAgent, fetchImpl = globalThis.fetch } = {}
) => {
  const config = getTelegramProxyConfig(env);
  if (!config) return {};
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is not available for Telegram proxy transport");
  }

  const agentOptions = { uri: config.uri };
  if (config.username) {
    agentOptions.token = `Basic ${Buffer.from(
      `${config.username}:${config.password}`,
      "utf8"
    ).toString("base64")}`;
  }
  const dispatcher = new ProxyAgentClass(agentOptions);

  return {
    fetch: (input, init = {}) => fetchImpl(input, { ...init, dispatcher }),
    maxRetries: 4,
    retryBackoffMs: 500,
  };
};

module.exports = {
  createTelegramBotOptions,
  getTelegramAxiosRequestConfig,
  getTelegramProxyConfig,
};
