const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000400-create-orders.js";
const TABLE = "orders";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "inventoryId",
      "phone",
      "firstName",
      "lastName",
      "middleName",
      "productType",
      "color",
      "size",
      "embroideryType",
      "embroideryTypeRu",
      "patronusCount",
      "petFaceCount",
      "customText",
      "comment",
      "orderDate",
      "status",
      "paidAt",
      "totalPrice",
      "deliveryAddress",
      "paymentProvider",
      "paymentStatus",
      "paykeeperInvoiceId",
      "paykeeperPaymentId",
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
        inventoryId: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: "inventories", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
        },
        phone: { type: Sequelize.STRING, allowNull: false },
        firstName: { type: Sequelize.STRING, allowNull: false },
        lastName: { type: Sequelize.STRING, allowNull: false },
        middleName: { type: Sequelize.STRING, allowNull: true },
        productType: { type: Sequelize.STRING, allowNull: false },
        color: { type: Sequelize.STRING, allowNull: false },
        size: { type: Sequelize.STRING, allowNull: false },
        embroideryType: { type: Sequelize.STRING, allowNull: false },
        embroideryTypeRu: { type: Sequelize.STRING, allowNull: true },
        patronusCount: { type: Sequelize.INTEGER, allowNull: true },
        petFaceCount: { type: Sequelize.INTEGER, allowNull: true },
        customText: { type: Sequelize.STRING, allowNull: true },
        comment: { type: Sequelize.TEXT, allowNull: true },
        orderDate: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        status: {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: "Ожидание оплаты",
        },
        paidAt: { type: Sequelize.DATE, allowNull: true },
        totalPrice: { type: Sequelize.INTEGER, allowNull: true },
        deliveryAddress: { type: Sequelize.STRING, allowNull: true },
        paymentProvider: { type: Sequelize.STRING, allowNull: true },
        paymentStatus: {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: "pending",
        },
        paykeeperInvoiceId: { type: Sequelize.STRING(64), allowNull: true },
        paykeeperPaymentId: { type: Sequelize.STRING(64), allowNull: true },
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
