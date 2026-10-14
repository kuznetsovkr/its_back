const { DataTypes } = require("sequelize");
const sequelize = require("../db");

module.exports = sequelize.define("cart_attachment", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  cartItemId: { type: DataTypes.UUID, allowNull: false, references: { model: "cart_items", key: "id" }, onDelete: "CASCADE" },
  fileName: { type: DataTypes.STRING(100), allowNull: false },
  originalName: { type: DataTypes.STRING(180), allowNull: false },
  mime: { type: DataTypes.STRING(32), allowNull: false },
  size: { type: DataTypes.INTEGER, allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: "cart_attachments", indexes: [{ unique: true, fields: ["cartItemId", "position"] }] });
