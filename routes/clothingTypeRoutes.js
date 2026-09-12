const express = require("express");
const ClothingType = require("../models/ClothingType");
const requireAdmin = require("../middleware/requireAdmin");
const { getPricingConfig } = require("../services/pricingConfig");
const { getStartingPrice } = require("../services/orderPricing");

const router = express.Router();

const asPublicType = (type, pricingConfig) => {
    const plain = type.get({ plain: true });
    try {
        return { ...plain, price: getStartingPrice({ clothingType: plain }, pricingConfig) };
    } catch {
        return { ...plain, price: null };
    }
};

router.get("/", async (_req, res) => {
    try {
        const [types, pricingConfig] = await Promise.all([
            ClothingType.findAll({ order: [["name", "ASC"]] }),
            getPricingConfig(),
        ]);
        res.json(types.map((type) => asPublicType(type, pricingConfig)));
    } catch (error) {
        console.error("Ошибка при получении типов одежды:", error);
        res.status(500).json({ message: "Не удалось получить типы одежды" });
    }
});

router.post("/", requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: "Нужно указать name" });
        }

        const created = await ClothingType.create({ name });
        const pricingConfig = await getPricingConfig();
        res.status(201).json(asPublicType(created, pricingConfig));
    } catch (error) {
        console.error("Ошибка при создании типа одежды:", error);
        res.status(500).json({ message: "Не удалось создать тип одежды" });
    }
});

router.put("/:id", requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        const type = await ClothingType.findByPk(req.params.id);

        if (!type) {
            return res.status(404).json({ message: "Тип одежды не найден" });
        }

        if (name !== undefined) type.name = name;
        await type.save();
        const pricingConfig = await getPricingConfig();
        res.json(asPublicType(type, pricingConfig));
    } catch (error) {
        console.error("Ошибка при обновлении типа одежды:", error);
        res.status(500).json({ message: "Не удалось обновить тип одежды" });
    }
});

router.delete("/:id", requireAdmin, async (req, res) => {
    try {
        const type = await ClothingType.findByPk(req.params.id);
        if (!type) {
            return res.status(404).json({ message: "Тип одежды не найден" });
        }

        await type.destroy();
        res.json({ message: "Тип одежды удалён" });
    } catch (error) {
        console.error("Ошибка при удалении типа одежды:", error);
        res.status(500).json({ message: "Не удалось удалить тип одежды" });
    }
});

module.exports = router;
