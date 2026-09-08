const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908001100-add-order-checkout-details.js";
const TABLE = "orders";
const COLUMNS = [
  "customTextFont",
  "recipientFullName",
  "recipientPhone",
  "email",
  "preferredContact",
  "deliveryComment",
  "deliveryCity",
  "deliveryMode",
  "privacyConsentAt",
];

module.exports = {
  baseline: {
    tableName: TABLE,
    mode: "alter",
    columns: COLUMNS,
  },

  async up(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await queryInterface.addColumn(TABLE, "customTextFont", {
        type: Sequelize.STRING(64),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "recipientFullName", {
        type: Sequelize.STRING(200),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "recipientPhone", {
        type: Sequelize.STRING(32),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "email", {
        type: Sequelize.STRING(254),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "preferredContact", {
        type: Sequelize.STRING(80),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "deliveryComment", {
        type: Sequelize.TEXT,
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "deliveryCity", {
        type: Sequelize.STRING(120),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "deliveryMode", {
        type: Sequelize.STRING(24),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(TABLE, "privacyConsentAt", {
        type: Sequelize.DATE,
        allowNull: true,
      }, { transaction });
    });
  },

  async down(queryInterface) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, MIGRATION_NAME, transaction);
      for (const column of [...COLUMNS].reverse()) {
        await queryInterface.removeColumn(TABLE, column, { transaction });
      }
    });
  },
};
