const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const InventoryReservation = sequelize.define("inventory_reservation", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  orderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: "orders", key: "id" },
    onDelete: "CASCADE",
  },
  inventoryId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: "inventories", key: "id" },
    onDelete: "RESTRICT",
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: { min: 1 },
  },
  status: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: "active",
    validate: { isIn: [["active", "committed", "released"]] },
  },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  committedAt: { type: DataTypes.DATE, allowNull: true },
  releasedAt: { type: DataTypes.DATE, allowNull: true },
  releaseReason: { type: DataTypes.STRING(64), allowNull: true },
}, {
  indexes: [
    { unique: true, fields: ["orderId"] },
    { fields: ["status", "expiresAt"] },
    { fields: ["inventoryId"] },
  ],
});

module.exports = InventoryReservation;
