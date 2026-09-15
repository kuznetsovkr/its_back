const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260915000100-add-order-payment-amount.js";
const TABLE = "orders";

module.exports = {
  baseline: {
    tableName: TABLE,
    mode: "alter",
    columns: ["paymentAmount"],
  },

  async up(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await queryInterface.addColumn(TABLE, "paymentAmount", {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      }, { transaction });
    });
  },

  async down(queryInterface) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, MIGRATION_NAME, transaction);
      await queryInterface.removeColumn(TABLE, "paymentAmount", { transaction });
    });
  },
};
