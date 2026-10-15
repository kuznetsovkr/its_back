const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261015000100-create-order-items.js";
module.exports = {
  baseline: { tableName: "order_items", columns: ["id", "orderId", "sourceCartItemId", "position", "inventoryId", "productType", "color", "size", "imageUrl", "embroideryType", "embroideryTypeRu", "patronusCount", "petFaceCount", "comment", "quantity", "unitPrice", "linePrice", "parcel", "createdAt", "updatedAt"], indexes: [{ unique: true, fields: ["orderId", "position"] }] },
  async up(q, S) {
    await withMigrationTransaction(q, async (transaction) => {
      await q.createTable("order_items", {
        id: { type: S.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        orderId: { type: S.INTEGER, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE" },
        sourceCartItemId: { type: S.UUID, allowNull: false }, position: { type: S.INTEGER, allowNull: false },
        inventoryId: { type: S.INTEGER, allowNull: true, references: { model: "inventories", key: "id" }, onDelete: "SET NULL" },
        productType: { type: S.STRING(120), allowNull: false }, color: { type: S.STRING(80), allowNull: false }, size: { type: S.STRING(16), allowNull: false },
        imageUrl: { type: S.TEXT, allowNull: true }, embroideryType: { type: S.STRING(32), allowNull: false }, embroideryTypeRu: { type: S.STRING(120), allowNull: false },
        patronusCount: { type: S.INTEGER, allowNull: false }, petFaceCount: { type: S.INTEGER, allowNull: false }, comment: { type: S.TEXT, allowNull: false, defaultValue: "" },
        quantity: { type: S.INTEGER, allowNull: false }, unitPrice: { type: S.INTEGER, allowNull: false }, linePrice: { type: S.INTEGER, allowNull: false }, parcel: { type: S.JSONB, allowNull: false },
        createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex("order_items", ["orderId", "position"], { unique: true, name: "order_items_position_uq", transaction });
      await q.sequelize.query('ALTER TABLE "order_items" ADD CONSTRAINT "order_item_amount_check" CHECK ("position" >= 0 AND "quantity" BETWEEN 1 AND 20 AND "unitPrice" > 0 AND "linePrice"::bigint = "unitPrice"::bigint * "quantity")', { transaction });
    });
  },
  async down(q) {
    await withMigrationTransaction(q, async (transaction) => {
      await assertMigrationCanRevert(q, NAME, transaction);
      const [rows] = await q.sequelize.query('SELECT 1 FROM "order_items" LIMIT 1', { transaction });
      if (rows.length) throw new Error("Cannot remove order items containing real orders; restore a backup or migrate these orders first");
      await q.dropTable("order_items", { transaction });
    });
  },
};
