const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const LowStockAlert = sequelize.define("low_stock_alert", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  inventoryId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  threshold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
  notifiedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  clearedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [{ unique: true, fields: ["inventoryId"] }],
});

module.exports = LowStockAlert;
