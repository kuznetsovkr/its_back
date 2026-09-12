const express = require("express");
const requireTrustedOrigin = require("../middleware/trustedOrigin");
const requireAdmin = require("../middleware/requireAdmin");
const { pricingQuoteRateLimit } = require("../middleware/rateLimit");
const { findInventoryForOrder } = require("../services/inventoryResolver");
const {
  PricingError,
  calculateCdekDelivery,
  calculateMerchandisePrice,
  getPriceCatalog,
} = require("../services/orderPricing");
const {
  RequestValidationError,
  assertAllowedKeys,
  ensurePlainObject,
  parseJsonObject,
  readPositiveInteger,
  readString,
} = require("../lib/requestValidation");
const { getPricingConfig, updatePricingConfig } = require("../services/pricingConfig");

const router = express.Router();

const readPricingConfig = (body) => {
  const config = ensurePlainObject(body, "body");
  assertAllowedKeys(config, new Set(["matrix", "additional"]), "настройках цен");
  const matrix = ensurePlainObject(config.matrix, "matrix");
  assertAllowedKeys(matrix, new Set(["Patronus", "Car", "petFace"]), "матрице цен");

  const readRow = (type) => {
    const row = ensurePlainObject(matrix[type], `matrix.${type}`);
    assertAllowedKeys(row, new Set(["tshirt", "svitshot", "hoodie"]), `matrix.${type}`);
    return {
      tshirt: readPositiveInteger(row.tshirt, `matrix.${type}.tshirt`, { max: 1_000_000 }),
      svitshot: readPositiveInteger(row.svitshot, `matrix.${type}.svitshot`, { max: 1_000_000 }),
      hoodie: readPositiveInteger(row.hoodie, `matrix.${type}.hoodie`, { max: 1_000_000 }),
    };
  };

  const additional = ensurePlainObject(config.additional, "additional");
  assertAllowedKeys(additional, new Set(["Patronus", "petFace"]), "доплатах");
  return {
    currency: "RUB",
    matrix: {
      Patronus: readRow("Patronus"),
      Car: readRow("Car"),
      petFace: readRow("petFace"),
    },
    additional: {
      Patronus: readPositiveInteger(additional.Patronus, "additional.Patronus", {
        min: 0,
        max: 1_000_000,
      }),
      petFace: readPositiveInteger(additional.petFace, "additional.petFace", {
        min: 0,
        max: 1_000_000,
      }),
    },
  };
};

router.get("/config", requireAdmin, async (_req, res) => {
  try {
    return res.json(await getPricingConfig());
  } catch (error) {
    console.error("[pricing] Failed to load pricing config:", error);
    return res.status(500).json({ message: "Не удалось загрузить настройки цен" });
  }
});

router.put("/config", requireAdmin, async (req, res) => {
  try {
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Content-Type должен быть application/json" });
    }
    return res.json(await updatePricingConfig(readPricingConfig(req.body)));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        field: error.field || undefined,
      });
    }
    console.error("[pricing] Failed to update pricing config:", error);
    return res.status(500).json({ message: "Не удалось сохранить настройки цен" });
  }
});

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

    const pricingConfig = await getPricingConfig();

    return res.json({
      currency: "RUB",
      prices: getPriceCatalog({ inventory, patronusCount, petFaceCount, pricingConfig }),
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

router.post("/checkout", requireTrustedOrigin, pricingQuoteRateLimit, async (req, res) => {
  try {
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Content-Type должен быть application/json" });
    }
    const body = ensurePlainObject(req.body, "body");
    assertAllowedKeys(
      body,
      new Set([
        "productType",
        "color",
        "size",
        "embroideryType",
        "patronusCount",
        "petFaceCount",
        "cdekMode",
        "cdekAddress",
      ]),
      "итоговом расчёте"
    );

    const productType = readString(body.productType, "productType", { required: true, max: 120 });
    const color = readString(body.color, "color", { required: true, max: 80 });
    const size = readString(body.size, "size", { required: true, max: 16 });
    const embroideryType = readString(body.embroideryType, "embroideryType", {
      required: true,
      max: 32,
    });
    const patronusCount = readPositiveInteger(body.patronusCount, "patronusCount", { max: 5 });
    const petFaceCount = readPositiveInteger(body.petFaceCount, "petFaceCount", { max: 5 });
    const cdekMode = readString(body.cdekMode, "cdekMode", { max: 16 }).toLowerCase();
    const cdekAddress = body.cdekAddress
      ? parseJsonObject(body.cdekAddress, "cdekAddress")
      : null;

    const inventory = await findInventoryForOrder(productType, color, size);
    if (!inventory) return res.status(404).json({ message: "Товар не найден" });
    if (inventory.quantity < 1) {
      return res.status(409).json({ message: "Товара нет в наличии" });
    }

    const pricingConfig = await getPricingConfig();
    const merchandiseQuote = calculateMerchandisePrice({
      inventory,
      embroideryType,
      patronusCount,
      petFaceCount,
      pricingConfig,
    });
    if (merchandiseQuote.manual || !cdekMode) {
      return res.json({
        currency: "RUB",
        manual: true,
        merchandisePrice: merchandiseQuote.merchandisePrice,
        deliveryPrice: null,
        totalPrice: null,
      });
    }

    const deliveryQuote = await calculateCdekDelivery({
      inventory,
      cdekMode,
      cdekAddress,
    });
    return res.json({
      currency: "RUB",
      manual: false,
      merchandisePrice: merchandiseQuote.merchandisePrice,
      deliveryPrice: deliveryQuote.deliveryPrice,
      totalPrice: merchandiseQuote.merchandisePrice + deliveryQuote.deliveryPrice,
    });
  } catch (error) {
    if (error instanceof PricingError || error instanceof RequestValidationError) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        field: error.field || undefined,
      });
    }
    console.error("[pricing] Failed to calculate checkout total:", error);
    return res.status(500).json({ message: "Не удалось рассчитать итоговую стоимость" });
  }
});

module.exports = router;
