const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261004000200-create-gift-certificate-reservations.js";
const TABLE = "gift_certificate_reservations";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: ["id", "certificateId", "orderId", "eligibleAmountKopecks", "amountKopecks", "testMode", "status", "expiresAt", "committedAt", "releasedAt", "releaseReason", "createdAt", "updatedAt"],
    indexes: [{ unique: true, fields: ["orderId"] }, { unique: false, fields: ["certificateId", "status", "expiresAt"] }],
  },
  async up(queryInterface, S) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await queryInterface.createTable(TABLE, {
        id: { type: S.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
        certificateId: { type: S.INTEGER, allowNull: false, references: { model: "gift_certificates", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        orderId: { type: S.INTEGER, allowNull: false, references: { model: "orders", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        eligibleAmountKopecks: { type: S.INTEGER, allowNull: false },
        amountKopecks: { type: S.INTEGER, allowNull: false },
        testMode: { type: S.BOOLEAN, allowNull: false },
        status: { type: S.STRING(24), allowNull: false, defaultValue: "active" },
        expiresAt: { type: S.DATE, allowNull: false },
        committedAt: { type: S.DATE, allowNull: true },
        releasedAt: { type: S.DATE, allowNull: true },
        releaseReason: { type: S.STRING(64), allowNull: true },
        createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["orderId"], { name: "gift_certificate_reservations_order_uq", unique: true, transaction });
      await queryInterface.addIndex(TABLE, ["certificateId", "status", "expiresAt"], { name: "gift_certificate_reservations_certificate_expiry_idx", transaction });
      await queryInterface.sequelize.query(`ALTER TABLE "gift_certificate_reservations"
        ADD CONSTRAINT "gift_certificate_reservations_money_check" CHECK ("amountKopecks" > 0 AND "amountKopecks" <= "eligibleAmountKopecks" AND "amountKopecks" <= 2000000),
        ADD CONSTRAINT "gift_certificate_reservations_state_check" CHECK (
          ("status" = 'active' AND "committedAt" IS NULL AND "releasedAt" IS NULL)
          OR ("status" = 'committed' AND "committedAt" IS NOT NULL AND "releasedAt" IS NULL)
          OR ("status" = 'released' AND "releasedAt" IS NOT NULL AND "committedAt" IS NULL)
        )`, { transaction });
    });
  },
  async down(queryInterface) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, NAME, transaction);
      await queryInterface.dropTable(TABLE, { transaction });
    });
  },
};
