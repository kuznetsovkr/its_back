const express = require("express");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const { pricingQuoteRateLimit } = require("../middleware/rateLimit");
const { findInventoryForOrder } = require("../services/inventoryResolver");
const { PricingError, getPriceCatalog } = require("../services/orderPricing");
const {
  RequestValidationError,
  assertAllowedKeys,
  ensurePlainObject,
  readPositiveInteger,
  readString,
} = require("../lib/requestValidation");

const router = express.Router();

router.post("/quote", requireTrustedOrigin, pricingQuoteRateLimit, async (req, res) => {
  try {
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Content-Type должен быть application/json" });
    }
    const body = ensurePlainObject(req.body, "body");
    assertAllowedKeys(
      body,
      new Set(["productType", "color", "size", "patronusCount", "petFaceCount"]),
      "расчёте стоимости"
    );
    const productType = readString(body.productType, "productType", { required: true, max: 120 });
    const color = readString(body.color, "color", { required: true, max: 80 });
    const size = readString(body.size, "size", { required: true, max: 16 });
    const patronusCount = readPositiveInteger(body.patronusCount, "patronusCount", { max: 5 });
    const petFaceCount = readPositiveInteger(body.petFaceCount, "petFaceCount", { max: 5 });
    const inventory = await findInventoryForOrder(productType, color, size);

    if (!inventory) {
      return res.status(404).json({ message: "Товар не найден" });
    }
    if (inventory.quantity < 1) {
      return res.status(409).json({ message: "Товара нет в наличии" });
    }

    return res.json({
      currency: "RUB",
      prices: getPriceCatalog({ inventory, patronusCount, petFaceCount }),
    });
  } catch (error) {
    if (error instanceof PricingError || error instanceof RequestValidationError) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        field: error.field || undefined,
      });
    }
    console.error("[pricing] Failed to calculate quote:", error);
    return res.status(500).json({ message: "Не удалось рассчитать стоимость" });
  }
});

module.exports = router;
