const { Op } = require("sequelize");
const Inventory = require("../models/Inventory");
const ClothingType = require("../models/ClothingType");

const withClothingType = {
  include: [{ model: ClothingType, as: "clothingType", attributes: ["id", "name", "price"] }],
};

const norm = (s) => String(s || "").trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");
const baseType = (s) => norm(s).replace(/\(.*?\)/g, "").trim(); // срезаем " (с начесом)"

async function findInventoryForOrder(productType, color, size) {
  const ptBase = baseType(productType);
  const col = norm(color);
  const sz = String(size || "").trim();

  // 1) точное совпадение
  let item = await Inventory.findOne({
    where: { productType, color, size: sz },
    ...withClothingType,
  });
  if (item) return item;

  // 2) case-insensitive
  item = await Inventory.findOne({
    where: { productType: { [Op.iLike]: productType }, color: { [Op.iLike]: color }, size: sz },
    ...withClothingType,
  });
  if (item) return item;

  // 3) по базовому типу без скобок
  item = await Inventory.findOne({
    where: { productType: { [Op.iLike]: ptBase + "%" }, color: { [Op.iLike]: color }, size: sz },
    ...withClothingType,
  });
  if (item) return item;

  // 4) жёсткая нормализация
  const all = await Inventory.findAll({ where: { size: sz }, ...withClothingType });
  return all.find(i => baseType(i.productType) === ptBase && norm(i.color) === col) || null;
}

module.exports = { findInventoryForOrder };
