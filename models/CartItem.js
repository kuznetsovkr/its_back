const { DataTypes } = require("sequelize");
const sequelize = require("../db");

module.exports = sequelize.define("cart_item", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  cartId: { type: DataTypes.UUID, allowNull: false, references: { model: "carts", key: "id" }, onDelete: "CASCADE" },
  requestKey: { type: DataTypes.UUID, allowNull: false },
  requestHash: { type: DataTypes.STRING(64), allowNull: false },
  inventoryId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "inventories", key: "id" }, onDelete: "SET NULL" },
  productType: { type: DataTypes.STRING(120), allowNull: false },
  color: { type: DataTypes.STRING(80), allowNull: false },
  size: { type: DataTypes.STRING(16), allowNull: false },
  imageUrl: { type: DataTypes.STRING, allowNull: true },
  embroideryType: { type: DataTypes.STRING(32), allowNull: false },
  embroideryTypeRu: { type: DataTypes.STRING(80), allowNull: false },
  patronusCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  petFaceCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  comment: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
  privacyConsentAt: { type: DataTypes.DATE, allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  deletedAt: { type: DataTypes.DATE, allowNull: true },
  filesPurgedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: "cart_items", indexes: [
  { unique: true, fields: ["cartId", "requestKey"] }, { fields: ["cartId", "deletedAt"] }, { fields: ["deletedAt", "filesPurgedAt"] },
] });
