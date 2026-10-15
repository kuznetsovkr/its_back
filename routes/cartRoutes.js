const express = require("express");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const { createRateLimiter } = require("../middleware/rateLimit");
const { assertAllowedKeys, ensurePlainObject, readString } = require("../lib/requestValidation");
const { readUuid, validateCartItem, validateCartQuantity } = require("../lib/cartRules");
const { orderImagesUpload, validateUploadedImages, cleanupTemporaryFilesAfterResponse, inspectStoredImage, streamImage, uploadErrorHandler } = require("../lib/uploadSecurity");
const { createCartService } = require("../services/carts");
const { validateCartQuote, validateCartCheckout } = require("../lib/cartCheckoutRules");
const { requireOrderAccessConfigured } = require("../middleware/orderAccess");

const limiter = (prefix, max) => createRateLimiter({ windowMs: 15 * 60_000, max, keyPrefix: prefix,
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || "unknown",
  message: "Слишком много запросов корзины. Повторите попытку позднее" });
const createLimit = limiter("cart-session", 6);
const readLimit = limiter("cart-read", 240);
const uploadLimit = limiter("cart-upload", 20);
const mutationLimit = limiter("cart-change", 60);
const quoteLimit = limiter("cart-quote", 30);
const checkoutLimit = limiter("cart-checkout", 6);

const createCartRouter = (deps = createCartService(), checkoutOverride = null) => {
  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const handleError = (error, res) => {
    if (error.statusCode && error.code) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    if (["ENOENT", "INVALID_STORED_IMAGE"].includes(error.code)) return res.status(404).json({ message: "Фотография недоступна" });
    console.error("[cart] Request failed");
    return res.status(500).json({ message: "Не удалось обработать корзину. Попробуйте ещё раз" });
  };
  const access = async (req, res, next) => {
    try {
      req.cartAccess = { cartId: readUuid(req.params.cartId), token: req.header("X-Cart-Access-Token") };
      await deps.assertAccess(req.cartAccess);
      return next();
    } catch (error) { return handleError(error, res); }
  };
  const json = (req, res, next) => req.is("application/json") ? next()
    : res.status(415).json({ message: "Content-Type должен быть application/json" });
  const checkoutService = () => checkoutOverride || require("../services/cartCheckout").createCartCheckoutService({ carts: deps });
  router.post("/:cartId/quote", requireTrustedOrigin, quoteLimit, access, json, async (req, res) => {
    try { return res.json(await checkoutService().quote(req.cartAccess, validateCartQuote(req.body))); }
    catch (error) { return handleError(error, res); }
  });
  router.post("/:cartId/checkout", requireTrustedOrigin, requireOrderAccessConfigured, checkoutLimit, access, json, async (req, res) => {
    try { return res.json(await checkoutService().create(req.cartAccess, validateCartCheckout(req.body), req.header("Idempotency-Key"), req.ip)); }
    catch (error) { return handleError(error, res); }
  });
  router.post("/:cartId/checkout/cancel", requireTrustedOrigin, mutationLimit, access, json, async (req, res) => {
    try {
      ensurePlainObject(req.body, "body"); assertAllowedKeys(req.body, new Set(), "отмене оформления");
      return res.json(await checkoutService().cancel(req.cartAccess));
    } catch (error) { return handleError(error, res); }
  });
  router.post("/session", requireTrustedOrigin, createLimit, json, async (req, res) => {
    try {
      ensurePlainObject(req.body, "body");
      assertAllowedKeys(req.body, new Set(["turnstileToken"]), "создании корзины");
      return res.status(201).json(await deps.createSession({ turnstileToken: readString(req.body.turnstileToken, "turnstileToken", { max: 2048 }), remoteIp: req.ip }));
    } catch (error) { return handleError(error, res); }
  });
  router.get("/:cartId", readLimit, access, async (req, res) => {
    try { return res.json(await deps.getCart(req.cartAccess)); }
    catch (error) { return handleError(error, res); }
  });
  router.post("/:cartId/items", requireTrustedOrigin, uploadLimit, access,
    (req, res, next) => {
      try { req.cartRequestKey = readUuid(req.header("Idempotency-Key"), "Idempotency-Key"); }
      catch (error) { return handleError(error, res); }
      return req.is("multipart/form-data") ? next() : res.status(415).json({ message: "Content-Type должен быть multipart/form-data" });
    }, orderImagesUpload, validateUploadedImages, cleanupTemporaryFilesAfterResponse, async (req, res) => {
      try {
        const input = validateCartItem(req.body, req.files);
        const result = await deps.addItem({ access: req.cartAccess, input, files: req.files, requestKey: req.cartRequestKey, remoteIp: req.ip });
        return res.status(result.alreadyAdded ? 200 : 201).json(result);
      } catch (error) { return handleError(error, res); }
    });
  router.patch("/:cartId/items/:itemId", requireTrustedOrigin, mutationLimit, access, json, async (req, res) => {
    try {
      return res.json(await deps.setQuantity(req.cartAccess, readUuid(req.params.itemId, "itemId"), validateCartQuantity(req.body)));
    } catch (error) { return handleError(error, res); }
  });
  router.delete("/:cartId/items/:itemId", requireTrustedOrigin, mutationLimit, access, async (req, res) => {
    try { return res.json(await deps.removeItem(req.cartAccess, readUuid(req.params.itemId, "itemId"))); }
    catch (error) { return handleError(error, res); }
  });
  router.delete("/:cartId", requireTrustedOrigin, mutationLimit, access, async (req, res) => {
    try { return res.json(await deps.clearCart(req.cartAccess)); }
    catch (error) { return handleError(error, res); }
  });
  router.get("/:cartId/items/:itemId/attachments/:attachmentId", readLimit, access, async (req, res, next) => {
    try {
      const file = await deps.getAttachment(req.cartAccess, req.params.itemId, req.params.attachmentId);
      const info = await inspectStoredImage(file.filePath);
      return streamImage({ res, next, filePath: file.filePath, info, downloadName: file.originalName });
    } catch (error) { return handleError(error, res); }
  });
  router.use(uploadErrorHandler);
  return router;
};
module.exports = { createCartRouter };
