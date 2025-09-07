// models/Order.js
const { DataTypes } = require("sequelize");
const sequelize = require("../db");
const User = require("./User");

const Order = sequelize.define("order", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: User, key: "id" }, onDelete: "SET NULL" },

  // склад
  inventoryId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "inventories", key: "id" }, onDelete: "SET NULL" },

  // контакты
  phone: { type: DataTypes.STRING, allowNull: false },
  firstName: { type: DataTypes.STRING, allowNull: false },
  lastName: { type: DataTypes.STRING, allowNull: false },
  middleName: { type: DataTypes.STRING, allowNull: true },

  // товар
  productType: { type: DataTypes.STRING, allowNull: false },
  color: { type: DataTypes.STRING, allowNull: false },
  size: { type: DataTypes.STRING, allowNull: false },

  // кастомизация
  embroideryType: { type: DataTypes.STRING, allowNull: false },
  customText: { type: DataTypes.STRING, allowNull: true },
  comment: { type: DataTypes.TEXT, allowNull: true },

  // даты/статусы бизнеса
  orderDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Ожидание оплаты" }, // это бизнес-статус
  paidAt: { type: DataTypes.DATE, allowNull: true },

  // сумма/доставка
  totalPrice: { type: DataTypes.INTEGER, allowNull: true }, // можно хранить в рублях пока
  deliveryAddress: { type: DataTypes.STRING, allowNull: true },

  // 🔽 платёжные поля (новое)
  paymentProvider: { type: DataTypes.STRING, allowNull: true }, // 'paykeeper'
  paymentStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" }, // 'pending' | 'paid' | 'failed'
  paykeeperInvoiceId: { type: DataTypes.STRING(64), allowNull: true },
  paykeeperPaymentId: { type: DataTypes.STRING(64), allowNull: true },
});

module.exports = Order;
