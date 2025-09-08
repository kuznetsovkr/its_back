const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const OrderAttachment = sequelize.define('OrderAttachment', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  orderId: { type: DataTypes.INTEGER, allowNull: false },
  path: { type: DataTypes.STRING, allowNull: false },   // абсолютный путь на диске
  mime: { type: DataTypes.STRING },
  originalName: { type: DataTypes.STRING },
  size: { type: DataTypes.INTEGER },
}, { tableName: 'order_attachments' });

module.exports = OrderAttachment;
