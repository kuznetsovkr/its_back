const express = require("express");
const axios = require("axios");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const { cdekCalculateRateLimit, cdekOfficesRateLimit } = require("../middleware/rateLimit");
const { RequestValidationError } = require("../lib/requestValidation");
const {
  buildCdekCalculatePayload,
  buildCdekOfficesParams,
} = require("../lib/cdekRequestValidation");
const { getCdekRequestContext } = require("../services/cdekClient");

const router = express.Router();
const SERVICE_PATHS = ["/service.php", "/api/service.php"];

const relayHeaders = (upstreamHeaders, res) => {
  for (const name of [
    "x-total-elements",
    "x-current-page",
    "x-total-pages",
    "x-service-version",
    "server-timing",
  ]) {
    const value = upstreamHeaders?.[name];
    if (value != null) res.setHeader(name, value);
  }
};

const handleCdekError = (error, res) => {
  if (error instanceof RequestValidationError) {
    return res.status(400).json({
      error: error.code,
      message: error.message,
      field: error.field || undefined,
    });
  }

  const statusCode = error.response?.status || 502;
  const details = error.response?.data || null;
  const message =
    details?.message ||
    details?.error?.[0]?.message ||
    details?.errors?.[0]?.message ||
    "CDEK service error";
  return res.status(statusCode).json({ error: "service_failed", message });
};

router.get(
  SERVICE_PATHS,
  requireTrustedOrigin,
  cdekOfficesRateLimit,
  async (req, res) => {
    try {
      if (String(req.query.action || "").toLowerCase() !== "offices") {
        return res.status(400).json({ message: "Unknown action" });
      }

      const params = buildCdekOfficesParams(req.query);
      const { baseUrl, headers } = await getCdekRequestContext();
      const response = await axios.get(`${baseUrl}/deliverypoints`, {
        params,
        headers,
        timeout: 15_000,
      });

      relayHeaders(response.headers, res);
      return res.status(200).json(response.data);
    } catch (error) {
      return handleCdekError(error, res);
    }
  }
);

router.post(
  SERVICE_PATHS,
  requireTrustedOrigin,
  cdekCalculateRateLimit,
  async (req, res) => {
    try {
      if (!req.is("application/json")) {
        return res.status(415).json({ message: "Content-Type должен быть application/json" });
      }
      if (String(req.body?.action || "").toLowerCase() !== "calculate") {
        return res.status(400).json({ message: "Unknown action" });
      }

      const payload = buildCdekCalculatePayload(req.body);
      const { baseUrl, headers } = await getCdekRequestContext();
      const response = await axios.post(`${baseUrl}/calculator/tarifflist`, payload, {
        headers,
        timeout: 15_000,
      });

      relayHeaders(response.headers, res);
      return res.status(200).json(response.data);
    } catch (error) {
      return handleCdekError(error, res);
    }
  }
);

router.all(SERVICE_PATHS, (_req, res) => {
  return res.status(405).json({ message: "Method not allowed" });
});

module.exports = router;
