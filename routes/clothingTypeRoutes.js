const express = require("express");
const sequelize = require("../db");
const ClothingType = require("../models/ClothingType");
const Inventory = require("../models/Inventory");
const requireAdmin = require("../middleware/requireAdmin");
const {
    createGeneratedTypeCode,
    serializeClothingType,
} = require("../services/clothingTypes");

const router = express.Router();

router.get("/", async (_req, res) => {
    try {
        const types = await ClothingType.findAll({
            order: [["displayOrder", "ASC"], ["name", "ASC"]],
        });
        res.json(types.map(serializeClothingType));
    } catch (error) {
        console.error("Ошибка при получении типов одежды:", error);
        res.status(500).json({ message: "Не удалось получить типы одежды" });
    }
});

router.post("/", requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        const normalizedName = String(name || "").trim();
        if (!normalizedName || normalizedName.length > 120) {
            return res.status(400).json({ message: "Нужно указать name" });
        }

        const maxDisplayOrder = Number(await ClothingType.max("displayOrder")) || 0;
        const created = await ClothingType.create({
            name: normalizedName,
            code: createGeneratedTypeCode(),
            displayOrder: maxDisplayOrder + 10,
        });
        res.status(201).json(serializeClothingType(created));
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "Тип изделия с таким названием уже существует" });
        }
        console.error("Ошибка при создании типа одежды:", error);
        res.status(500).json({ message: "Не удалось создать тип одежды" });
    }
});

router.put("/:id", requireAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        const normalizedName = String(name || "").trim();
        if (!normalizedName || normalizedName.length > 120) {
            return res.status(400).json({ message: "Нужно указать корректное name" });
        }
        let type;
        await sequelize.transaction(async (transaction) => {
            type = await ClothingType.findByPk(req.params.id, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!type) return;
            type.name = normalizedName;
            await type.save({ transaction });
            await Inventory.update(
                { productType: normalizedName },
                { where: { clothingTypeId: type.id }, transaction }
            );
        });

        if (!type) return res.status(404).json({ message: "Тип одежды не найден" });
        res.json(serializeClothingType(type));
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "Тип изделия с таким названием уже существует" });
        }
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
        if (await Inventory.count({ where: { clothingTypeId: type.id } })) {
            return res.status(409).json({ message: "Сначала удалите складские позиции этого типа" });
        }

        await type.destroy();
        res.json({ message: "Тип одежды удалён" });
    } catch (error) {
        console.error("Ошибка при удалении типа одежды:", error);
        res.status(500).json({ message: "Не удалось удалить тип одежды" });
    }
});

module.exports = router;
