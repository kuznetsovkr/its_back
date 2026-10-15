const { DataTypes } = require("sequelize");
const sequelize = require("../db");
module.exports = sequelize.define("cart_checkout", {
  id: { type: DataTypes.UUID, primaryKey: true },
  cartId: { type: DataTypes.UUID, allowNull: true, references: { model: "carts", key: "id" }, onDelete: "SET NULL" },
  orderId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE" },
  requestHash: { type: DataTypes.STRING(64), allowNull: false },
}, { tableName: "cart_checkouts", indexes: [{ unique: true, fields: ["orderId"] }, { fields: ["cartId"] }] });
