const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const TelegramChannelSubscriber = sequelize.define("telegram_channel_subscriber", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  channel: { type: DataTypes.STRING(32), allowNull: false },
  chatId: { type: DataTypes.STRING, allowNull: false },
  username: { type: DataTypes.STRING },
  firstName: { type: DataTypes.STRING },
  lastName: { type: DataTypes.STRING },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  indexes: [{ unique: true, fields: ["channel", "chatId"] }],
});

module.exports = TelegramChannelSubscriber;
