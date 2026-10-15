const { DataTypes } = require("sequelize");
const sequelize = require("../db");

module.exports = sequelize.define("cart", {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  accessTokenHash: { type: DataTypes.STRING(64), allowNull: false },
  firstUploadProofExpiresAt: { type: DataTypes.DATE, allowNull: true },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  checkoutOrderId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "orders", key: "id" }, onDelete: "SET NULL" },
}, { tableName: "carts", indexes: [{ fields: ["expiresAt"] }] });
