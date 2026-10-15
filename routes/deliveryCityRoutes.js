const express = require("express");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const { createRateLimiter } = require("../middleware/rateLimit");
const { createCityService } = require("../services/deliveryCities");
const { ensurePlainObject, assertAllowedKeys, readString } = require("../lib/requestValidation");
const cityLimit = createRateLimiter({ windowMs: 15 * 60_000, max: 120, keyPrefix: "delivery-cities", message: "Слишком много запросов городов. Попробуйте позднее" });

const createDeliveryCityRouter = (service = createCityService()) => {
  const router = express.Router();
  router.use(requireTrustedOrigin, cityLimit);
  for (const action of ["suggest", "resolve", "office"]) router.post(`/${action}`, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!req.is("application/json")) return res.status(415).json({ message: "Content-Type должен быть application/json" });
      const body = ensurePlainObject(req.body, "body");
      const field = action === "suggest" ? "query" : action === "resolve" ? "id" : "officeCode";
      assertAllowedKeys(body, new Set([field]), "выборе города");
      const value = readString(body[field], field, { required: true, min: action === "suggest" ? 2 : 1, max: action === "suggest" ? 120 : 64 });
      if (action === "office" && !/^[\p{L}\p{N}_-]{1,32}$/u.test(value)) return res.status(400).json({ message: "Выберите корректный ПВЗ СДЭК" });
      return res.json(action === "suggest" ? { suggestions: await service.suggest(value) } : { city: await service[action](value) });
    } catch (error) {
      return res.status(error.statusCode || 503).json({ message: error.statusCode ? error.message : "Сервис городов временно недоступен", field: error.field });
    }
  });
  return router;
};
module.exports = { createDeliveryCityRouter };
