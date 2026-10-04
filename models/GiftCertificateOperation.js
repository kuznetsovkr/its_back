const { DataTypes } = require("sequelize");
const sequelize = require("../db");

module.exports = sequelize.define("gift_certificate_operation", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  certificateId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "gift_certificates", key: "id" }, onDelete: "RESTRICT" },
  orderId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "orders", key: "id" }, onDelete: "RESTRICT" },
  type: { type: DataTypes.STRING(24), allowNull: false, validate: { isIn: [["issue", "debit"]] } },
  deltaKopecks: { type: DataTypes.INTEGER, allowNull: false },
  balanceAfterKopecks: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0, max: 2_000_000 } },
  idempotencyKey: { type: DataTypes.STRING(96), allowNull: false },
}, {
  indexes: [
    { unique: true, fields: ["idempotencyKey"] },
    { unique: true, fields: ["orderId"] },
    { fields: ["certificateId", "createdAt"] },
  ],
});
