const express = require("express");
const Inventory = require("../models/Inventory");
const ClothingType = require("../models/ClothingType");

const router = express.Router();

const asPlainWithPrice = (item) => {
    const plain = item.get({ plain: true });
    const ct = plain.clothingType;
    return {
        ...plain,
        price: ct ? ct.price : null,
        clothingTypeName: ct ? ct.name : null,
    };
};

// Получить весь инвентарь
router.get("/", async (_req, res) => {
    try {
        const inventory = await Inventory.findAll({
            include: [{ model: ClothingType, as: "clothingType", attributes: ["id", "name", "price"] }],
        });
        res.json(inventory.map(asPlainWithPrice));
    } catch (error) {
        console.error("Ошибка при получении инвентаря:", error);
        res.status(500).json({ message: "Не удалось получить данные" });
    }
});

// Добавить позицию
router.post("/", async (req, res) => {
    try {
        const { productType, color, colorCode, size, quantity, imageUrl, clothingTypeId } = req.body;

        const newItem = await Inventory.create({
            productType,
            color,
            colorCode,
            size,
            quantity,
            clothingTypeId,
            imageUrl,
        });

        const createdWithPrice = await Inventory.findByPk(newItem.id, {
            include: [{ model: ClothingType, as: "clothingType", attributes: ["id", "name", "price"] }],
        });

        res.json(asPlainWithPrice(createdWithPrice));
    } catch (error) {
        console.error("Ошибка при создании инвентаря:", error);
        res.status(500).json({ message: "Не удалось создать запись" });
    }
});

// Обновить позицию
router.put("/:id", async (req, res) => {
    try {
        const { productType, color, colorCode, quantity, size, imageUrl, clothingTypeId } = req.body;
        const item = await Inventory.findByPk(req.params.id);

        if (!item) {
            return res.status(404).json({ message: "Позиция не найдена" });
        }

        item.productType = productType;
        item.color = color;
        item.colorCode = colorCode;
        item.quantity = quantity;
        item.size = size;
        item.imageUrl = imageUrl;
        item.clothingTypeId = clothingTypeId;
        await item.save();

        const savedWithPrice = await Inventory.findByPk(item.id, {
            include: [{ model: ClothingType, as: "clothingType", attributes: ["id", "name", "price"] }],
        });

        res.json(asPlainWithPrice(savedWithPrice));
    } catch (err) {
        console.error("Ошибка при обновлении инвентаря:", err);
        res.status(500).json({ message: "Не удалось обновить запись" });
    }
});

// Удалить позицию
router.delete("/:id", async (req, res) => {
    try {
        const item = await Inventory.findByPk(req.params.id);
        if (!item) return res.status(404).json({ message: "Позиция не найдена" });

        await item.destroy();
        res.json({ message: "Позиция удалена" });
    } catch (error) {
        console.error("Ошибка при удалении инвентаря:", error);
        res.status(500).json({ message: "Не удалось удалить запись" });
    }
});

module.exports = router;
