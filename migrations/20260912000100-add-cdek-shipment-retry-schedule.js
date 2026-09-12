const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260912000100-add-cdek-shipment-retry-schedule.js";
const TABLE = "order_shipments";
const INDEX = "order_shipments_status_next_attempt_idx";

module.exports = {
  baseline: {
    tableName: TABLE,
    mode: "alter",
    columns: ["nextAttemptAt"],
    indexes: [
      { unique: false, fields: ["status", "nextAttemptAt"] },
    ],
  },

  async up(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await queryInterface.addColumn(TABLE, "nextAttemptAt", {
        type: Sequelize.DATE,
        allowNull: true,
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["status", "nextAttemptAt"], {
        name: INDEX,
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, MIGRATION_NAME, transaction);
      await queryInterface.removeIndex(TABLE, INDEX, { transaction });
      await queryInterface.removeColumn(TABLE, "nextAttemptAt", { transaction });
    });
  },
};
