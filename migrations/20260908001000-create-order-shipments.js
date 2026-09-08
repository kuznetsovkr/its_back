const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908001000-create-order-shipments.js";
const TABLE = "order_shipments";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "orderId",
      "provider",
      "status",
      "tariffCode",
      "deliveryPoint",
      "recipientName",
      "recipientPhone",
      "declaredValue",
      "providerUuid",
      "cdekNumber",
      "attempts",
      "processingStartedAt",
      "createdAtProvider",
      "lastError",
      "createdAt",
      "updatedAt",
    ],
    indexes: [
      { unique: true, fields: ["orderId"] },
      { unique: false, fields: ["status", "processingStartedAt"] },
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
        provider: {
          type: Sequelize.STRING(24),
          allowNull: false,
          defaultValue: "cdek",
        },
        status: {
          type: Sequelize.STRING(32),
          allowNull: false,
          defaultValue: "pending_payment",
        },
        tariffCode: { type: Sequelize.INTEGER, allowNull: false },
        deliveryPoint: { type: Sequelize.STRING(32), allowNull: false },
        recipientName: { type: Sequelize.STRING(200), allowNull: false },
        recipientPhone: { type: Sequelize.STRING(32), allowNull: false },
        declaredValue: { type: Sequelize.INTEGER, allowNull: false },
        providerUuid: { type: Sequelize.STRING(64), allowNull: true },
        cdekNumber: { type: Sequelize.STRING(64), allowNull: true },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        processingStartedAt: { type: Sequelize.DATE, allowNull: true },
        createdAtProvider: { type: Sequelize.DATE, allowNull: true },
        lastError: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["orderId"], {
        name: "order_shipments_order_uq",
        unique: true,
        transaction,
      });
      await queryInterface.addIndex(TABLE, ["status", "processingStartedAt"], {
        name: "order_shipments_status_processing_idx",
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
