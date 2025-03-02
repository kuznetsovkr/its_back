const express = require("express");
const Inventory = require("../models/Inventory");
const router = express.Router();

// ✅ Получить все позиции склада
router.get("/", async (req, res) => {
    try {
        const inventory = await Inventory.findAll();
        res.json(inventory);
    } catch (error) {
        console.error("Ошибка получения склада:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// ✅ Добавить новую позицию
router.post("/", async (req, res) => {
    try {
        const { productType, color,size, quantity, imageUrl } = req.body; // ✅ Принимаем imageUrl

        const newItem = await Inventory.create({
            productType,
            color,
            size,
            quantity,
            imageUrl, // ✅ Сохраняем ссылку в базу
        });

        res.json(newItem);
    } catch (error) {
        console.error("Ошибка при добавлении товара:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.put("/:id", async (req, res) => {
    try {
        const { productType, color, quantity, size, imageUrl } = req.body;
        const item = await Inventory.findByPk(req.params.id);

        if (!item) {
            return res.status(404).json({ message: "Товар не найден" });
        }

        item.productType = productType;
        item.color = color;
        item.quantity = quantity;
        item.size = size;
        item.imageUrl = imageUrl;
        await item.save();

        res.json(item);
    } catch (err) {
        console.error("Ошибка обновления товара:", err);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// ✅ Удалить позицию
router.delete("/:id", async (req, res) => {
    try {
        const item = await Inventory.findByPk(req.params.id);
        if (!item) return res.status(404).json({ message: "Позиция не найдена" });

        await item.destroy();
        res.json({ message: "Позиция удалена" });
    } catch (error) {
        console.error("Ошибка удаления позиции:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

module.exports = router;
