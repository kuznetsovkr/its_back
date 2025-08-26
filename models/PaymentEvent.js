// models/PaymentEvent.js
const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const PaymentEvent = sequelize.define("payment_event", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  provider: { type: DataTypes.STRING, allowNull: false },          // 'manual' | 'paykeeper' ...
  eventId: { type: DataTypes.STRING, allowNull: false, unique: true }, // уникальный id события
  orderId: { type: DataTypes.INTEGER, allowNull: false },
  payload: { type: DataTypes.JSON },
});

module.exports = PaymentEvent;
