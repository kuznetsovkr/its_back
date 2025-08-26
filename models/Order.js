// models/Order.js
const { DataTypes } = require("sequelize");
const sequelize = require("../db");
const User = require("./User");

const Order = sequelize.define("order", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: User, key: "id" },
    onDelete: "SET NULL",
  },
  phone: { type: DataTypes.STRING, allowNull: false },
  firstName: { type: DataTypes.STRING, allowNull: false },
  lastName: { type: DataTypes.STRING, allowNull: false },
  middleName: { type: DataTypes.STRING, allowNull: true },

  productType: { type: DataTypes.STRING, allowNull: false },
  color: { type: DataTypes.STRING, allowNull: false },
  size: { type: DataTypes.STRING, allowNull: false },

  embroideryType: { type: DataTypes.STRING, allowNull: false },
  customText: { type: DataTypes.STRING, allowNull: true },
  comment: { type: DataTypes.TEXT, allowNull: true },

  orderDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

  // Важно: по умолчанию — «ожидание оплаты»
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Ожидание оплаты" },
  paidAt: { type: DataTypes.DATE, allowNull: true },

  // опционально
  totalPrice: { type: DataTypes.INTEGER, allowNull: true },
  deliveryAddress: { type: DataTypes.STRING, allowNull: true },
});

module.exports = Order;
