const { DataTypes } = require("sequelize");
const sequelize = require("../db");
module.exports = sequelize.define("order_item", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  orderId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE" },
  sourceCartItemId: { type: DataTypes.UUID, allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false },
  inventoryId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "inventories", key: "id" }, onDelete: "SET NULL" },
  productType: { type: DataTypes.STRING(120), allowNull: false },
  color: { type: DataTypes.STRING(80), allowNull: false },
  size: { type: DataTypes.STRING(16), allowNull: false },
  imageUrl: { type: DataTypes.TEXT, allowNull: true },
  embroideryType: { type: DataTypes.STRING(32), allowNull: false },
  embroideryTypeRu: { type: DataTypes.STRING(120), allowNull: false },
  carDesign: { type: DataTypes.STRING(16), allowNull: true },
  patronusCount: { type: DataTypes.INTEGER, allowNull: false },
  petFaceCount: { type: DataTypes.INTEGER, allowNull: false },
  comment: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
  quantity: { type: DataTypes.INTEGER, allowNull: false },
  unitPrice: { type: DataTypes.INTEGER, allowNull: false },
  linePrice: { type: DataTypes.INTEGER, allowNull: false },
  parcel: { type: DataTypes.JSONB, allowNull: false },
}, { tableName: "order_items", indexes: [{ unique: true, fields: ["orderId", "position"] }] });
