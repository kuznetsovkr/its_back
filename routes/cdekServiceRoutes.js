const express = require("express");
const axios = require("axios");

const router = express.Router();

const DEFAULT_CDEK_BASE_URL = "https://api.cdek.ru/v2";
const AUTH_MARGIN_MS = 30_000;
const CDEK_SERVICE_TOKEN = process.env.CDEK_SERVICE_TOKEN || process.env.JWT_SECRET || "";

const tokenCache = {
  token: null,
  expiresAt: 0,
};

const pickNonEmpty = (obj) => {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== null && value !== undefined && value !== "") {
      out[key] = value;
    }
  }
  return out;
};

const parseJsonIfNeeded = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
};

const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (!digits) return "";

  if (digits[0] !== "7" && digits[0] !== "8") {
    return `+${digits}`;
  }

  if (digits[0] === "8") {
    return `+7${digits.slice(1)}`;
  }

  return `+${digits}`;
};

const buildFromLocation = (fromRaw) => {
  const from = parseJsonIfNeeded(fromRaw) || {};

  return pickNonEmpty({
    country_code: from.country_code,
    code: from.city_code || from.code,
    postal_code: from.postal_code,
    address: from.address,
  });
};

const buildToLocation = (addressRaw) => {
  const address = parseJsonIfNeeded(addressRaw) || {};
  const nested = address.location || {};

  return pickNonEmpty({
    country_code: address.country_code || nested.country_code,
    code: address.city_code || nested.city_code || nested.code,
    postal_code: address.postal_code || nested.postal_code,
    address: address.formatted || address.address || nested.address,
  });
};

const buildPackages = (goodsRaw, totalPriceRaw) => {
  const goods = parseJsonIfNeeded(goodsRaw) || [];
  if (!Array.isArray(goods) || goods.length === 0) return [];

  const totalPrice = Number.isFinite(Number(totalPriceRaw)) ? Number(totalPriceRaw) : 0;
  const baseCost = Math.floor(totalPrice / goods.length);
  const remainder = totalPrice - baseCost * goods.length;

  return goods.map((item, idx) => {
    const weightGrams = Number.isFinite(Number(item.weight_grams))
      ? Number(item.weight_grams)
      : Number.isFinite(Number(item.weight))
      ? Math.round(Number(item.weight) * 1000)
      : 100;

    const cost = baseCost + (idx === 0 ? remainder : 0);

    return pickNonEmpty({
      number: `pkg-${idx + 1}`,
      weight: weightGrams > 0 ? weightGrams : 100,
      length: Number.isFinite(Number(item.length)) ? Number(item.length) : undefined,
      width: Number.isFinite(Number(item.width)) ? Number(item.width) : undefined,
      height: Number.isFinite(Number(item.height)) ? Number(item.height) : undefined,
      items: [
        {
          name: item.name || `Item ${idx + 1}`,
          ware_key: item.ware_key || `SKU-${idx + 1}`,
          cost,
          payment: { value: 0 },
          weight: weightGrams > 0 ? weightGrams : 100,
          amount: 1,
        },
      ],
    });
  });
};

const buildOrderPayload = (data) => {
  if (data.tariff_code && data.recipient && (data.to_location || data.delivery_point)) {
    const payload = { ...data };
    delete payload.action;
    if (payload.type == null) payload.type = 1;
    return payload;
  }

  const payload = { type: 1 };

  payload.number = data.number || data.orderNumber || data.orderId || data.id || `order-${Date.now()}`;

  const parsedTariff = parseJsonIfNeeded(data.cdekTariff) || {};
  payload.tariff_code =
    data.cdekTariffCode ||
    data.tariff_code ||
    parsedTariff.tariff_code ||
    parsedTariff.code ||
    undefined;

  payload.from_location = buildFromLocation(data.cdekFrom);

  const cdekMode = data.cdekMode || "office";
  const address = parseJsonIfNeeded(data.cdekAddress) || {};

  if (cdekMode === "office") {
    payload.delivery_point =
      address.code || data.cdekPvzCode || data.cdekCode || address.office_code || undefined;
  } else {
    payload.to_location = buildToLocation(address);
  }

  const recipientName = String(data.recipientFullName || "").trim() ||
    [data.lastName, data.firstName, data.middleName].filter(Boolean).join(" ");

  payload.recipient = {
    name: recipientName || "Получатель",
    phones: [{ number: normalizePhone(data.recipientPhoneDigits || data.phone || "") }],
  };

  payload.packages = buildPackages(data.cdekGoods, data.totalPrice);

  if (data.cdekAddressLabel) {
    payload.comment = data.cdekAddressLabel;
  } else if (data.comment) {
    payload.comment = data.comment;
  }

  const deliveryPayment = parseJsonIfNeeded(data.deliveryPayment) || {};
  if (deliveryPayment.payer === "sender") {
    payload.delivery_recipient_cost = { value: 0 };
    payload.recipient_currency = "RUB";
  }

  delete payload.action;
  return payload;
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

const relayHeaders = (upstreamHeaders, res) => {
  const passthrough = [
    "x-total-elements",
    "x-current-page",
    "x-total-pages",
    "x-service-version",
    "server-timing",
  ];

  for (const name of passthrough) {
    const value = upstreamHeaders?.[name];
    if (value != null) {
      res.setHeader(name, value);
    }
  }
};

const setCorsHeaders = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CDEK-Service-Token");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "X-Total-Elements, X-Current-Page, X-Total-Pages, X-Service-Version, Server-Timing"
  );
};

const makeDataBag = (req) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return { ...req.query, ...body };
};

router.options(["/service.php", "/api/service.php"], (req, res) => {
  setCorsHeaders(res);
  res.sendStatus(200);
});

router.all(["/service.php", "/api/service.php"], async (req, res) => {
  setCorsHeaders(res);

  try {
    const data = makeDataBag(req);
    const action = String(data.action || "").trim().toLowerCase();

    if (!action) {
      return res.status(400).json({ message: "Action is required" });
    }

    const token = await getCdekToken();
    const { baseUrl } = resolveCdekConfig();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (action === "create_order" || action === "register_order") {
      if (!CDEK_SERVICE_TOKEN) {
        return res.status(500).json({ message: "CDEK service token is not configured" });
      }

      const incomingServiceToken = String(req.headers["x-cdek-service-token"] || "");
      if (!incomingServiceToken || incomingServiceToken !== CDEK_SERVICE_TOKEN) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    if (action === "offices") {
      const params = {
        ...data,
        type: data.type || "PVZ",
        country_code: data.country_code || "RU",
        lang: data.lang || "rus",
        size: data.size || 500,
        page: data.page != null && data.page !== "" ? data.page : 0,
      };
      delete params.action;

      const response = await axios.get(`${baseUrl}/deliverypoints`, {
        params,
        headers,
        timeout: 15_000,
      });

      relayHeaders(response.headers, res);
      return res.status(200).json(response.data);
    }

    if (action === "calculate") {
      const payload = { ...data };
      delete payload.action;

      const response = await axios.post(`${baseUrl}/calculator/tarifflist`, payload, {
        headers,
        timeout: 15_000,
      });

      relayHeaders(response.headers, res);
      return res.status(200).json(response.data);
    }

    if (action === "create_order" || action === "register_order") {
      const payload = buildOrderPayload(data);

      const response = await axios.post(`${baseUrl}/orders`, payload, {
        headers,
        timeout: 15_000,
      });

      relayHeaders(response.headers, res);
      return res.status(200).json(response.data);
    }

    return res.status(400).json({ message: "Unknown action" });
  } catch (error) {
    const statusCode = error.response?.status || 502;
    const details = error.response?.data || null;
    const message =
      details?.message ||
      details?.error?.[0]?.message ||
      details?.errors?.[0]?.message ||
      error.message ||
      "CDEK service error";

    return res.status(statusCode).json({
      error: "service_failed",
      message,
      details,
    });
  }
});

module.exports = router;
