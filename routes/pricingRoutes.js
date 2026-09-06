const express = require("express");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const { pricingQuoteRateLimit } = require("../middleware/rateLimit");
const { findInventoryForOrder } = require("../services/inventoryResolver");
const { PricingError, getPriceCatalog } = require("../services/orderPricing");

const router = express.Router();

router.post("/quote", requireTrustedOrigin, pricingQuoteRateLimit, async (req, res) => {
  try {
    const { productType, color, size, patronusCount, petFaceCount } = req.body || {};
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
    if (error instanceof PricingError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error("[pricing] Failed to calculate quote:", error);
    return res.status(500).json({ message: "Не удалось рассчитать стоимость" });
  }
});

module.exports = router;
