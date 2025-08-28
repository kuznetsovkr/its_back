const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const TelegramSubscriber = sequelize.define("telegram_subscriber", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  chatId: { type: DataTypes.STRING, allowNull: false, unique: true },
  username: { type: DataTypes.STRING },
  firstName: { type: DataTypes.STRING },
  lastName: { type: DataTypes.STRING },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ unique: true, fields: ["chatId"] }],
});

module.exports = TelegramSubscriber;
