const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261014000300-create-cart-attachments.js";
module.exports = {
  baseline: { tableName: "cart_attachments", columns: ["id", "cartItemId", "fileName", "originalName", "mime", "size", "position", "createdAt", "updatedAt"],
    indexes: [{ unique: true, fields: ["cartItemId", "position"] }] },
  async up(q, S) {
    await withMigrationTransaction(q, async (transaction) => {
      await q.createTable("cart_attachments", {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        cartItemId: { type: S.UUID, allowNull: false, references: { model: "cart_items", key: "id" }, onDelete: "CASCADE" },
        fileName: { type: S.STRING(100), allowNull: false }, originalName: { type: S.STRING(180), allowNull: false },
        mime: { type: S.STRING(32), allowNull: false }, size: { type: S.INTEGER, allowNull: false }, position: { type: S.INTEGER, allowNull: false },
        createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex("cart_attachments", ["cartItemId", "position"], { name: "cart_attachments_position_uq", unique: true, transaction });
      await q.sequelize.query('ALTER TABLE "cart_attachments" ADD CONSTRAINT "cart_attachments_values_check" CHECK ("size" BETWEEN 1 AND 5242880 AND "position" BETWEEN 0 AND 9 AND "mime" IN (\'image/jpeg\',\'image/png\',\'image/webp\'))', { transaction });
    });
  },
  async down(q) {
    await withMigrationTransaction(q, async (transaction) => {
      await assertMigrationCanRevert(q, NAME, transaction);
      await q.dropTable("cart_attachments", { transaction });
    });
  },
};
