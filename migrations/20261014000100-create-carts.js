const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261014000100-create-carts.js";
module.exports = {
  baseline: { tableName: "carts", columns: ["id", "accessTokenHash", "firstUploadProofExpiresAt", "expiresAt", "createdAt", "updatedAt"], indexes: [{ unique: false, fields: ["expiresAt"] }] },
  async up(q, S) {
    await withMigrationTransaction(q, async (transaction) => {
      await q.createTable("carts", {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        accessTokenHash: { type: S.STRING(64), allowNull: false },
        firstUploadProofExpiresAt: { type: S.DATE, allowNull: true },
        expiresAt: { type: S.DATE, allowNull: false },
        createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex("carts", ["expiresAt"], { name: "carts_expiry_idx", transaction });
    });
  },
  async down(q) {
    await withMigrationTransaction(q, async (transaction) => {
      await assertMigrationCanRevert(q, NAME, transaction);
      await q.dropTable("carts", { transaction });
    });
  },
};
