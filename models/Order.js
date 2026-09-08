const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const Order = sequelize.define("order", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

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
  customTextFont: { type: DataTypes.STRING(64), allowNull: true },
  comment: { type: DataTypes.TEXT, allowNull: true },

  // Checkout details
  recipientFullName: { type: DataTypes.STRING(200), allowNull: true },
  recipientPhone: { type: DataTypes.STRING(32), allowNull: true },
  email: { type: DataTypes.STRING(254), allowNull: true },
  preferredContact: { type: DataTypes.STRING(80), allowNull: true },
  deliveryComment: { type: DataTypes.TEXT, allowNull: true },
  deliveryCity: { type: DataTypes.STRING(120), allowNull: true },
  deliveryMode: { type: DataTypes.STRING(24), allowNull: true },
  privacyConsentAt: { type: DataTypes.DATE, allowNull: true },

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
