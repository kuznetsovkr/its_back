const { DataTypes } = require("sequelize");
const sequelize = require("../db");

module.exports = sequelize.define("gift_certificate_reservation", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  certificateId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "gift_certificates", key: "id" }, onDelete: "RESTRICT" },
  orderId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "RESTRICT" },
  eligibleAmountKopecks: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
  amountKopecks: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
  testMode: { type: DataTypes.BOOLEAN, allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "active", validate: { isIn: [["active", "committed", "released"]] } },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  committedAt: { type: DataTypes.DATE, allowNull: true },
  releasedAt: { type: DataTypes.DATE, allowNull: true },
  releaseReason: { type: DataTypes.STRING(64), allowNull: true },
}, {
  indexes: [
    { unique: true, fields: ["orderId"] },
    { fields: ["certificateId", "status", "expiresAt"] },
  ],
});
