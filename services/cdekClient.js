const axios = require("axios");

const DEFAULT_CDEK_BASE_URL = "https://api.cdek.ru/v2";
const AUTH_MARGIN_MS = 30_000;

const tokenCache = {
  token: null,
  expiresAt: 0,
};

const resolveCdekConfig = () => {
  const baseUrl = String(process.env.CDEK_BASE_URL || DEFAULT_CDEK_BASE_URL).replace(/\/+$/, "");
  const clientId = process.env.CDEK_CLIENT_ID || process.env.CDEK_ACCOUNT;
  const clientSecret = process.env.CDEK_CLIENT_SECRET || process.env.CDEK_PASSWORD;

  if (!clientId || !clientSecret) {
    throw new Error("CDEK credentials are not configured");
  }

  return { baseUrl, clientId, clientSecret };
};

const getCdekToken = async () => {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt - AUTH_MARGIN_MS) {
    return tokenCache.token;
  }

  const { baseUrl, clientId, clientSecret } = resolveCdekConfig();
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await axios.post(`${baseUrl}/oauth/token`, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10_000,
  });

  if (!response.data?.access_token) {
    throw new Error("CDEK auth token is missing in response");
  }

  const ttlSec = Number(response.data.expires_in) || 3600;
  tokenCache.token = response.data.access_token;
  tokenCache.expiresAt = Date.now() + ttlSec * 1000;

  return tokenCache.token;
};

const getCdekRequestContext = async () => {
  const token = await getCdekToken();
  const { baseUrl } = resolveCdekConfig();
  return {
    baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
};

module.exports = {
  getCdekRequestContext,
  getCdekToken,
  resolveCdekConfig,
};
