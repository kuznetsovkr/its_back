const express = require("express");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const { requireCertificateAccess } = require("../middleware/certificateAccess");
const { createRateLimiter, orderReadRateLimit, paymentLinkRateLimit } = require("../middleware/rateLimit");
const services = require("../services/certificateCheckout");
const certificateCreateLimit = createRateLimiter({
  windowMs: 15 * 60_000, max: 6, keyPrefix: "certificate-create",
  message: "Слишком много попыток покупки сертификата. Попробуйте позднее",
});
const createCertificateRouter = (deps = services) => {
  const router = express.Router();
  const handleError = (error, res) => {
    if (error.statusCode && error.code) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    console.error("[certificate-checkout] Request failed");
    return res.status(502).json({ message: "Не удалось обработать покупку сертификата. Попробуйте ещё раз" });
  };
  router.get("/config", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json(deps.getPublicCertificateConfig());
  });
  router.post("/purchase", requireTrustedOrigin, certificateCreateLimit, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) return res.status(415).json({ message: "Content-Type должен быть application/json" });
    try {
      return res.status(201).json(await deps.beginCertificateCheckout({
        body: req.body, requestKey: req.header("Idempotency-Key"), remoteIp: req.ip,
      }));
    } catch (error) { return handleError(error, res); }
  });
  router.post("/:id/payment", requireTrustedOrigin, requireCertificateAccess, paymentLinkRateLimit, async (req, res) => {
    if (!req.is("application/json") || !req.body || Array.isArray(req.body) || Object.keys(req.body).length) {
      return res.status(400).json({ message: "Отправьте пустой JSON-объект без суммы и реквизитов" });
    }
    try { return res.json(await deps.createCertificatePaymentLink(req.certificateId)); }
    catch (error) { return handleError(error, res); }
  });
  router.get("/:id/status", requireCertificateAccess, orderReadRateLimit, async (req, res) => {
    try { return res.json(await deps.getCertificatePurchaseStatus(req.certificateId)); }
    catch (error) { return handleError(error, res); }
  });
  return router;
};
module.exports = { createCertificateRouter };
