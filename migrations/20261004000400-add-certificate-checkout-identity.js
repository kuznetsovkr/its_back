const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261004000400-add-certificate-checkout-identity.js";
module.exports = {
  baseline: { tableName: "gift_certificates", mode: "alter", columns: ["purchaseRequestHash", "checkoutInputHash", "invoiceRequestedAt"], indexes: [{ unique: true, fields: ["purchaseRequestHash"] }] },
  async up(q, S) {
    await withMigrationTransaction(q, async (transaction) => {
      for (const name of ["purchaseRequestHash", "checkoutInputHash"]) {
        await q.addColumn("gift_certificates", name, { type: S.STRING(64), allowNull: true }, { transaction });
      }
      await q.addIndex("gift_certificates", ["purchaseRequestHash"], { name: "gift_certificates_purchase_request_uq", unique: true, transaction });
      await q.addColumn("gift_certificates", "invoiceRequestedAt", { type: S.DATE, allowNull: true }, { transaction });
    });
  },
  async down(q) {
    await withMigrationTransaction(q, async (transaction) => {
      await assertMigrationCanRevert(q, NAME, transaction);
      await q.removeIndex("gift_certificates", "gift_certificates_purchase_request_uq", { transaction });
      for (const name of ["purchaseRequestHash", "checkoutInputHash", "invoiceRequestedAt"]) await q.removeColumn("gift_certificates", name, { transaction });
    });
  },
};
