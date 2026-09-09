const { Op } = require("sequelize");
const Inventory = require("../models/Inventory");
const ClothingType = require("../models/ClothingType");

const withClothingType = {
  include: [{ model: ClothingType, as: "clothingType", attributes: ["id", "name", "price"] }],
};

async function findInventoryForOrder(productType, color, size) {
  const sz = String(size || "").trim();

  // Сначала используем точное совпадение, затем допускаем только различия в регистре.
  let item = await Inventory.findOne({
    where: { productType, color, size: sz },
    ...withClothingType,
  });
  if (item) return item;

  return Inventory.findOne({
    where: { productType: { [Op.iLike]: productType }, color: { [Op.iLike]: color }, size: sz },
    ...withClothingType,
  });
}

module.exports = { findInventoryForOrder };
