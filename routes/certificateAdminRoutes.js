const express = require("express");
const requireAdmin = require("../middleware/requireAdmin");
const { orderReadRateLimit } = require("../middleware/rateLimit");
const { assertAllowedKeys, readPositiveInteger: readInteger } = require("../lib/requestValidation");
const services = require("../services/certificateAdmin");
const createCertificateAdminRouter = (deps = services) => {
  const router = express.Router();
  router.use(requireAdmin, orderReadRateLimit);
  const handler = (method) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      assertAllowedKeys(req.query, new Set(["page", "pageSize"]));
      const input = { page: readInteger(req.query.page ?? 1, "Страница", { min: 1, max: 100_000 }),
        pageSize: readInteger(req.query.pageSize ?? 25, "Размер страницы", { min: 1, max: 100 }) };
      if (req.params.id) input.id = readInteger(req.params.id, "Номер сертификата", { min: 1, max: 2_147_483_647 });
      return res.json(await deps[method](input));
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ message: error.message, code: error.code });
      console.error("[certificate-admin] Read failed");
      return res.status(500).json({ message: "Не удалось загрузить сертификаты" });
    }
  };
  router.get("/", handler("listCertificates"));
  router.get("/:id/history", handler("certificateHistory"));
  return router;
};
module.exports = { createCertificateAdminRouter };
