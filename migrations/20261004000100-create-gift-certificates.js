const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261004000100-create-gift-certificates.js";
const TABLE = "gift_certificates";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: ["id", "buyerFullName", "buyerPhone", "buyerEmail", "preferredContact", "comment", "privacyConsentAt", "nominalKopecks", "balanceKopecks", "paymentAmountKopecks", "testMode", "status", "paykeeperInvoiceId", "paykeeperPaymentId", "paidAt", "expiresAt", "codeHash", "codeEncrypted", "createdAt", "updatedAt"],
    indexes: [
      { unique: true, fields: ["codeHash"] }, { unique: true, fields: ["paykeeperInvoiceId"] },
      { unique: true, fields: ["paykeeperPaymentId"] }, { unique: false, fields: ["status", "expiresAt"] },
    ],
  },
  async up(queryInterface, S) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await queryInterface.createTable(TABLE, {
        id: { type: S.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
        buyerFullName: { type: S.STRING(200), allowNull: false },
        buyerPhone: { type: S.STRING(32), allowNull: false },
        buyerEmail: { type: S.STRING(254), allowNull: false },
        preferredContact: { type: S.STRING(80), allowNull: true },
        comment: { type: S.TEXT, allowNull: true },
        privacyConsentAt: { type: S.DATE, allowNull: false },
        nominalKopecks: { type: S.INTEGER, allowNull: false },
        balanceKopecks: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        paymentAmountKopecks: { type: S.INTEGER, allowNull: false },
        testMode: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
        status: { type: S.STRING(24), allowNull: false, defaultValue: "pending" },
        paykeeperInvoiceId: { type: S.STRING(64), allowNull: true },
        paykeeperPaymentId: { type: S.STRING(64), allowNull: true },
        paidAt: { type: S.DATE, allowNull: true },
        expiresAt: { type: S.DATE, allowNull: true },
        codeHash: { type: S.STRING(64), allowNull: true },
        codeEncrypted: { type: S.STRING(512), allowNull: true },
        createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      for (const field of ["codeHash", "paykeeperInvoiceId", "paykeeperPaymentId"]) {
        await queryInterface.addIndex(TABLE, [field], { name: `gift_certificates_${field}_uq`, unique: true, transaction });
      }
      await queryInterface.addIndex(TABLE, ["status", "expiresAt"], { name: "gift_certificates_status_expiry_idx", transaction });
      await queryInterface.sequelize.query(`ALTER TABLE "gift_certificates"
        ADD CONSTRAINT "gift_certificates_money_check" CHECK (
          "nominalKopecks" IN (100000,200000,300000,400000,500000,600000,800000,1000000,1200000,1400000,1600000,1800000,2000000)
          AND "balanceKopecks" BETWEEN 0 AND "nominalKopecks"
          AND "paymentAmountKopecks" = CASE WHEN "testMode" THEN 100 ELSE "nominalKopecks" END
        ),
        ADD CONSTRAINT "gift_certificates_state_check" CHECK (
          ("status" = 'pending' AND "balanceKopecks" = 0 AND "paidAt" IS NULL AND "expiresAt" IS NULL AND "codeHash" IS NULL AND "codeEncrypted" IS NULL AND "paykeeperPaymentId" IS NULL)
          OR ("status" IN ('active','used','annulled') AND "paidAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "paidAt"
            AND "codeHash" IS NOT NULL AND "codeEncrypted" IS NOT NULL AND "paykeeperPaymentId" IS NOT NULL AND "paykeeperInvoiceId" IS NOT NULL)
        ),
        ADD CONSTRAINT "gift_certificates_used_check" CHECK ("status" <> 'used' OR "balanceKopecks" = 0)`, { transaction });
    });
  },
  async down(queryInterface) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, NAME, transaction);
      await queryInterface.dropTable(TABLE, { transaction });
    });
  },
};
