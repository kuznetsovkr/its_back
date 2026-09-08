const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000200-create-colors.js";
const TABLE = "colors";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: ["id", "name", "code"],
    indexes: [{ unique: true, fields: ["name"] }],
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
        name: { type: Sequelize.STRING, allowNull: false },
        code: { type: Sequelize.STRING(7), allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["name"], {
        name: "colors_name_uq",
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
