const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000600-create-low-stock-alerts.js";
const TABLE = "low_stock_alerts";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "inventoryId",
      "threshold",
      "notifiedAt",
      "clearedAt",
      "createdAt",
      "updatedAt",
    ],
    indexes: [{ unique: true, fields: ["inventoryId"] }],
  },

  async up(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await queryInterface.createTable(TABLE, {
        id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        inventoryId: { type: Sequelize.INTEGER, allowNull: false },
        threshold: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
        notifiedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        clearedAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["inventoryId"], {
        name: "low_stock_alerts_inventory_uq",
        unique: true,
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, MIGRATION_NAME, transaction);
      await queryInterface.dropTable(TABLE, { transaction });
    });
  },
};
