const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000900-create-inventory-reservations.js";
const TABLE = "inventory_reservations";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "orderId",
      "inventoryId",
      "quantity",
      "status",
      "expiresAt",
      "committedAt",
      "releasedAt",
      "releaseReason",
      "createdAt",
      "updatedAt",
    ],
    indexes: [
      { unique: true, fields: ["orderId"] },
      { unique: false, fields: ["status", "expiresAt"] },
      { unique: false, fields: ["inventoryId"] },
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
        orderId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: "orders", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
        },
        inventoryId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: { model: "inventories", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT",
        },
        quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        status: {
          type: Sequelize.STRING(24),
          allowNull: false,
          defaultValue: "active",
        },
        expiresAt: { type: Sequelize.DATE, allowNull: false },
        committedAt: { type: Sequelize.DATE, allowNull: true },
        releasedAt: { type: Sequelize.DATE, allowNull: true },
        releaseReason: { type: Sequelize.STRING(64), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["orderId"], {
        name: "inventory_reservations_order_uq",
        unique: true,
        transaction,
      });
      await queryInterface.addIndex(TABLE, ["status", "expiresAt"], {
        name: "inventory_reservations_status_expiry_idx",
        transaction,
      });
      await queryInterface.addIndex(TABLE, ["inventoryId"], {
        name: "inventory_reservations_inventory_idx",
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
