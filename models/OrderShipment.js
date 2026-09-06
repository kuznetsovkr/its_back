const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const OrderShipment = sequelize.define("order_shipment", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  orderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: "orders", key: "id" },
    onDelete: "CASCADE",
  },
  provider: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "cdek" },
  status: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: "pending_payment",
    validate: {
      isIn: [["pending_payment", "ready", "processing", "created", "failed", "cancelled"]],
    },
  },
  tariffCode: { type: DataTypes.INTEGER, allowNull: false },
  deliveryPoint: { type: DataTypes.STRING(32), allowNull: false },
  recipientName: { type: DataTypes.STRING(200), allowNull: false },
  recipientPhone: { type: DataTypes.STRING(32), allowNull: false },
  declaredValue: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0 } },
  providerUuid: { type: DataTypes.STRING(64), allowNull: true },
  cdekNumber: { type: DataTypes.STRING(64), allowNull: true },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
  processingStartedAt: { type: DataTypes.DATE, allowNull: true },
  createdAtProvider: { type: DataTypes.DATE, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
}, {
  indexes: [
    { unique: true, fields: ["orderId"] },
    { fields: ["status", "processingStartedAt"] },
  ],
});

module.exports = OrderShipment;
