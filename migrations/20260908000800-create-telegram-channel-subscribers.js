const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260908000800-create-telegram-channel-subscribers.js";
const TABLE = "telegram_channel_subscribers";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "channel",
      "chatId",
      "username",
      "firstName",
      "lastName",
      "isActive",
      "createdAt",
      "updatedAt",
    ],
    indexes: [{ unique: true, fields: ["channel", "chatId"] }],
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
        channel: { type: Sequelize.STRING(32), allowNull: false },
        chatId: { type: Sequelize.STRING, allowNull: false },
        username: { type: Sequelize.STRING, allowNull: true },
        firstName: { type: Sequelize.STRING, allowNull: true },
        lastName: { type: Sequelize.STRING, allowNull: true },
        isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex(TABLE, ["channel", "chatId"], {
        name: "telegram_channel_subscribers_channel_chat_uq",
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
