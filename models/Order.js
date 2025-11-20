const { DataTypes } = require("sequelize");
const sequelize = require("../db");
const User = require("./User");

const Order = sequelize.define("order", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: User, key: "id" }, onDelete: "SET NULL" },

  // Inventory linkage
  inventoryId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "inventories", key: "id" }, onDelete: "SET NULL" },

  // Customer
  phone: { type: DataTypes.STRING, allowNull: false },
  firstName: { type: DataTypes.STRING, allowNull: false },
  lastName: { type: DataTypes.STRING, allowNull: false },
  middleName: { type: DataTypes.STRING, allowNull: true },

  // Item
  productType: { type: DataTypes.STRING, allowNull: false },
  color: { type: DataTypes.STRING, allowNull: false },
  size: { type: DataTypes.STRING, allowNull: false },

  // Embroidery
  embroideryType: { type: DataTypes.STRING, allowNull: false },
  embroideryTypeRu: { type: DataTypes.STRING, allowNull: true },
  patronusCount: { type: DataTypes.INTEGER, allowNull: true },
  petFaceCount: { type: DataTypes.INTEGER, allowNull: true },
  customText: { type: DataTypes.STRING, allowNull: true },
  comment: { type: DataTypes.TEXT, allowNull: true },

  // Dates/status
  orderDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Ожидание оплаты" },
  paidAt: { type: DataTypes.DATE, allowNull: true },

  // Payment
  totalPrice: { type: DataTypes.INTEGER, allowNull: true },
  deliveryAddress: { type: DataTypes.STRING, allowNull: true },

  // Provider info
  paymentProvider: { type: DataTypes.STRING, allowNull: true },
  paymentStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
  paykeeperInvoiceId: { type: DataTypes.STRING(64), allowNull: true },
  paykeeperPaymentId: { type: DataTypes.STRING(64), allowNull: true },
});

module.exports = Order;
