const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000300-create-inventories.js";
const TABLE = "inventories";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "productType",
      "color",
      "size",
      "clothingTypeId",
      "quantity",
      "imageUrl",
      "colorCode",
      "createdAt",
      "updatedAt",
    ],
    indexes: [{ unique: true, fields: ["productType", "color", "size"] }],
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
        productType: { type: Sequelize.STRING, allowNull: false },
        color: { type: Sequelize.STRING, allowNull: false },
        size: { type: Sequelize.STRING, allowNull: false },
        clothingTypeId: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: "clothingTypes", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
        },
        quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        imageUrl: { type: Sequelize.STRING, allowNull: true },
        colorCode: { type: Sequelize.STRING(7), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["productType", "color", "size"], {
        name: "inventories_product_color_size_uq",
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
