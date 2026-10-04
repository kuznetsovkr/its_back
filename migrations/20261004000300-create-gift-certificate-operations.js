const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261004000300-create-gift-certificate-operations.js";
const TABLE = "gift_certificate_operations";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: ["id", "certificateId", "orderId", "type", "deltaKopecks", "balanceAfterKopecks", "idempotencyKey", "createdAt", "updatedAt"],
    indexes: [{ unique: true, fields: ["idempotencyKey"] }, { unique: true, fields: ["orderId"] }, { unique: false, fields: ["certificateId", "createdAt"] }],
  },
  async up(queryInterface, S) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await queryInterface.createTable(TABLE, {
        id: { type: S.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
        certificateId: { type: S.INTEGER, allowNull: false, references: { model: "gift_certificates", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        orderId: { type: S.INTEGER, allowNull: true, references: { model: "orders", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
        type: { type: S.STRING(24), allowNull: false },
        deltaKopecks: { type: S.INTEGER, allowNull: false },
        balanceAfterKopecks: { type: S.INTEGER, allowNull: false },
        idempotencyKey: { type: S.STRING(96), allowNull: false },
        createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["idempotencyKey"], { name: "gift_certificate_operations_key_uq", unique: true, transaction });
      await queryInterface.addIndex(TABLE, ["orderId"], { name: "gift_certificate_operations_order_uq", unique: true, transaction });
      await queryInterface.addIndex(TABLE, ["certificateId", "createdAt"], { name: "gift_certificate_operations_certificate_idx", transaction });
      await queryInterface.sequelize.query(`ALTER TABLE "gift_certificate_operations"
        ADD CONSTRAINT "gift_certificate_operations_balance_check" CHECK ("balanceAfterKopecks" BETWEEN 0 AND 2000000),
        ADD CONSTRAINT "gift_certificate_operations_delta_check" CHECK (
          ("type" = 'issue' AND "deltaKopecks" > 0 AND "deltaKopecks" <= 2000000 AND "orderId" IS NULL)
          OR ("type" = 'debit' AND "deltaKopecks" < 0 AND "deltaKopecks" >= -2000000 AND "orderId" IS NOT NULL)
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
