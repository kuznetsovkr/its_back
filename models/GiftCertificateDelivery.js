const { DataTypes } = require("sequelize");
const sequelize = require("../db");
module.exports = sequelize.define("gift_certificate_delivery", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  certificateId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "gift_certificates", key: "id" }, onDelete: "RESTRICT" },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "pending", validate: { isIn: [["pending", "sending", "sent", "failed"]] } },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: DataTypes.DATE, allowNull: false },
  lockedUntil: { type: DataTypes.DATE, allowNull: true },
  sentAt: { type: DataTypes.DATE, allowNull: true },
  lastErrorCode: { type: DataTypes.STRING(40), allowNull: true },
}, { indexes: [{ unique: true, fields: ["certificateId"] }, { fields: ["status", "nextAttemptAt"] }] });
