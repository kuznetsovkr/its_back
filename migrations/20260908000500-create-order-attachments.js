const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000500-create-order-attachments.js";
const TABLE = "order_attachments";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "orderId",
      "path",
      "mime",
      "originalName",
      "size",
      "createdAt",
      "updatedAt",
    ],
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
        orderId: { type: Sequelize.INTEGER, allowNull: false },
        path: { type: Sequelize.STRING, allowNull: false },
        mime: { type: Sequelize.STRING, allowNull: true },
        originalName: { type: Sequelize.STRING, allowNull: true },
        size: { type: Sequelize.INTEGER, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
    });
  },

  async down(queryInterface) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, MIGRATION_NAME, transaction);
      await queryInterface.dropTable(TABLE, { transaction });
    });
  },
};
