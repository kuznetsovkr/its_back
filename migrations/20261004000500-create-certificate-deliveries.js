const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261004000500-create-certificate-deliveries.js";
const TABLE = "gift_certificate_deliveries";
module.exports = {
  baseline: {
    tableName: TABLE,
    columns: ["id", "certificateId", "status", "attempts", "nextAttemptAt", "lockedUntil", "sentAt", "lastErrorCode", "createdAt", "updatedAt"],
    indexes: [{ unique: true, fields: ["certificateId"] }, { unique: false, fields: ["status", "nextAttemptAt"] }],
  },
  async up(q, S) {
    await withMigrationTransaction(q, async (transaction) => {
      await q.createTable(TABLE, {
        id: { type: S.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        certificateId: { type: S.INTEGER, allowNull: false, references: { model: "gift_certificates", key: "id" }, onDelete: "RESTRICT" },
        status: { type: S.STRING(24), allowNull: false, defaultValue: "pending" },
        attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        nextAttemptAt: { type: S.DATE, allowNull: false },
        lockedUntil: { type: S.DATE, allowNull: true },
        sentAt: { type: S.DATE, allowNull: true },
        lastErrorCode: { type: S.STRING(40), allowNull: true },
        createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex(TABLE, ["certificateId"], { name: "gift_certificate_deliveries_certificate_uq", unique: true, transaction });
      await q.addIndex(TABLE, ["status", "nextAttemptAt"], { name: "gift_certificate_deliveries_retry_idx", transaction });
      await q.sequelize.query('ALTER TABLE "gift_certificate_deliveries" ADD CONSTRAINT "gift_certificate_delivery_state_check" CHECK ("attempts" BETWEEN 0 AND 12 AND (("status" IN (\'pending\',\'failed\') AND "lockedUntil" IS NULL AND "sentAt" IS NULL) OR ("status" = \'sending\' AND "lockedUntil" IS NOT NULL AND "sentAt" IS NULL) OR ("status" = \'sent\' AND "sentAt" IS NOT NULL AND "lockedUntil" IS NULL)))', { transaction });
    });
  },
  async down(q) {
    await withMigrationTransaction(q, async (transaction) => {
      await assertMigrationCanRevert(q, NAME, transaction);
      await q.dropTable(TABLE, { transaction });
    });
  },
};
