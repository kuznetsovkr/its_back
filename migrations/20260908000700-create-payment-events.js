const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000700-create-payment-events.js";
const TABLE = "payment_events";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "provider",
      "eventId",
      "orderId",
      "payload",
      "createdAt",
      "updatedAt",
    ],
    indexes: [{ unique: true, fields: ["eventId"] }],
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
        provider: { type: Sequelize.STRING, allowNull: false },
        eventId: { type: Sequelize.STRING, allowNull: false },
        orderId: { type: Sequelize.INTEGER, allowNull: false },
        payload: { type: Sequelize.JSON, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["eventId"], {
        name: "payment_events_event_uq",
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
