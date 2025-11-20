const express = require("express");
const ClothingType = require("../models/ClothingType");

const router = express.Router();

router.get("/", async (_req, res) => {
    try {
        const types = await ClothingType.findAll({ order: [["name", "ASC"]] });
        res.json(types);
    } catch (error) {
        console.error("Ошибка при получении типов одежды:", error);
        res.status(500).json({ message: "Не удалось получить типы одежды" });
    }
});

router.post("/", async (req, res) => {
    try {
        const { name, price } = req.body;
        if (!name || price === undefined) {
            return res.status(400).json({ message: "Нужно указать name и price" });
        }

        const created = await ClothingType.create({ name, price });
        res.status(201).json(created);
    } catch (error) {
        console.error("Ошибка при создании типа одежды:", error);
        res.status(500).json({ message: "Не удалось создать тип одежды" });
    }
});

router.put("/:id", async (req, res) => {
    try {
        const { name, price } = req.body;
        const type = await ClothingType.findByPk(req.params.id);

        if (!type) {
            return res.status(404).json({ message: "Тип одежды не найден" });
        }

        if (name !== undefined) type.name = name;
        if (price !== undefined) type.price = price;

        await type.save();
        res.json(type);
    } catch (error) {
        console.error("Ошибка при обновлении типа одежды:", error);
        res.status(500).json({ message: "Не удалось обновить тип одежды" });
    }
});

router.delete("/:id", async (req, res) => {
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
