const { DataTypes } = require("sequelize");
const sequelize = require("../db");

module.exports = sequelize.define("gift_certificate", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  buyerFullName: { type: DataTypes.STRING(200), allowNull: false },
  buyerPhone: { type: DataTypes.STRING(32), allowNull: false },
  buyerEmail: { type: DataTypes.STRING(254), allowNull: false },
  preferredContact: { type: DataTypes.STRING(80), allowNull: true },
  comment: { type: DataTypes.TEXT, allowNull: true },
  privacyConsentAt: { type: DataTypes.DATE, allowNull: false },
  nominalKopecks: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 100_000, max: 2_000_000 } },
  balanceKopecks: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0, max: 2_000_000 } },
  paymentAmountKopecks: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
  testMode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "pending", validate: { isIn: [["pending", "active", "used", "annulled"]] } },
  paykeeperInvoiceId: { type: DataTypes.STRING(64), allowNull: true },
  paykeeperPaymentId: { type: DataTypes.STRING(64), allowNull: true },
  paidAt: { type: DataTypes.DATE, allowNull: true },
  expiresAt: { type: DataTypes.DATE, allowNull: true },
  codeHash: { type: DataTypes.STRING(64), allowNull: true },
  codeEncrypted: { type: DataTypes.STRING(512), allowNull: true },
  purchaseRequestHash: { type: DataTypes.STRING(64), allowNull: true },
  checkoutInputHash: { type: DataTypes.STRING(64), allowNull: true },
  invoiceRequestedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [
    { unique: true, fields: ["codeHash"] },
    { unique: true, fields: ["paykeeperInvoiceId"] },
    { unique: true, fields: ["paykeeperPaymentId"] },
    { unique: true, fields: ["purchaseRequestHash"] },
    { fields: ["status", "expiresAt"] },
  ],
});
