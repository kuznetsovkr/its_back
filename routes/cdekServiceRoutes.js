const express = require("express");
const axios = require("axios");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const { cdekCalculateRateLimit, cdekOfficesRateLimit } = require("../middleware/rateLimit");
const { RequestValidationError } = require("../lib/requestValidation");
const {
  buildCdekCalculatePayload,
  buildCdekOfficesByCoordinateParams,
  buildCdekOfficesParams,
} = require("../lib/cdekRequestValidation");
const { getCdekRequestContext } = require("../services/cdekClient");
const { calculateCdekTariff, PricingError } = require("../services/orderPricing");

const router = express.Router();
const SERVICE_PATHS = ["/service.php", "/api/service.php"];
const CDEK_WIDGET_SERVICE_VERSION = "4.0.0";

const setWidgetHeaders = (res) => {
  res.setHeader("X-Service-Version", CDEK_WIDGET_SERVICE_VERSION);
};

const withWidgetClientHeaders = (headers) => ({
  ...headers,
  "X-App-Name": "widget_pvz",
  "X-App-Version": CDEK_WIDGET_SERVICE_VERSION,
});

const relayHeaders = (upstreamHeaders, res) => {
  for (const name of [
    "x-total-elements",
    "x-current-page",
    "x-total-pages",
    "server-timing",
  ]) {
    const value = upstreamHeaders?.[name];
    if (value != null) res.setHeader(name, value);
  }
};

const handleCdekError = (error, res) => {
  if (error instanceof RequestValidationError || error instanceof PricingError) {
    return res.status(error.statusCode || 400).json({
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
    setWidgetHeaders(res);
    try {
      const action = String(req.query.action || "").toLowerCase();
      if (!["offices", "bycoordinate"].includes(action)) {
        return res.status(400).json({ message: "Unknown action" });
      }

      const isPolygonRequest = action === "bycoordinate";
      const params = isPolygonRequest
        ? buildCdekOfficesByCoordinateParams(Object.fromEntries(Object.entries(req.query).filter(([key]) => key !== "shippingContext")))
        : buildCdekOfficesParams(Object.fromEntries(Object.entries(req.query).filter(([key]) => key !== "shippingContext")));
      const { baseUrl, headers } = await getCdekRequestContext();
      const endpoint = isPolygonRequest ? "deliverypoints/byPolygons" : "deliverypoints";
      const response = await axios.get(`${baseUrl}/${endpoint}`, {
        params,
        headers: withWidgetClientHeaders(headers),
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
    setWidgetHeaders(res);
    try {
      if (!req.is("application/json")) {
        return res.status(415).json({ message: "Content-Type должен быть application/json" });
      }
      if (String(req.body?.action || "").toLowerCase() !== "calculate") {
        return res.status(400).json({ message: "Unknown action" });
      }

      if (req.query.shippingContext) {
        const payload = buildCdekCalculatePayload(req.body, [], req.query.shippingContext);
        const quote = await calculateCdekTariff({ packages: payload.packages, declaredValue: payload.declaredValue, toLocation: payload.to_location });
        res.set("Cache-Control", "no-store");
        return res.json({ tariff_codes: [{ ...quote.tariff, tariff_code: quote.tariffCode, tariff_name: "СДЭК — до ПВЗ",
          delivery_mode: 4, delivery_sum: quote.deliveryPrice, total_sum: quote.deliveryPrice }] });
      }
      // Old cached clients must refresh, not show an uninsured/incorrect quote.
      throw new RequestValidationError("Обновите страницу для расчёта доставки со страховкой", "shippingContext");
    } catch (error) {
      return handleCdekError(error, res);
    }
  }
);

router.all(SERVICE_PATHS, (_req, res) => {
  setWidgetHeaders(res);
  return res.status(405).json({ message: "Method not allowed" });
});

module.exports = router;
