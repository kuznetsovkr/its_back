const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261014000200-create-cart-items.js";
module.exports = {
  baseline: { tableName: "cart_items", columns: ["id", "cartId", "requestKey", "requestHash", "inventoryId", "productType", "color", "size", "imageUrl", "embroideryType", "embroideryTypeRu", "patronusCount", "petFaceCount", "comment", "privacyConsentAt", "quantity", "deletedAt", "filesPurgedAt", "createdAt", "updatedAt"],
    indexes: [{ unique: true, fields: ["cartId", "requestKey"] }, { unique: false, fields: ["cartId", "deletedAt"] }, { unique: false, fields: ["deletedAt", "filesPurgedAt"] }] },
  async up(q, S) {
    await withMigrationTransaction(q, async (transaction) => {
      await q.createTable("cart_items", {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        cartId: { type: S.UUID, allowNull: false, references: { model: "carts", key: "id" }, onDelete: "CASCADE" },
        requestKey: { type: S.UUID, allowNull: false }, requestHash: { type: S.STRING(64), allowNull: false },
        inventoryId: { type: S.INTEGER, allowNull: true, references: { model: "inventories", key: "id" }, onDelete: "SET NULL" },
        productType: { type: S.STRING(120), allowNull: false }, color: { type: S.STRING(80), allowNull: false }, size: { type: S.STRING(16), allowNull: false },
        imageUrl: { type: S.STRING, allowNull: true }, embroideryType: { type: S.STRING(32), allowNull: false }, embroideryTypeRu: { type: S.STRING(80), allowNull: false },
        patronusCount: { type: S.INTEGER, allowNull: false, defaultValue: 1 }, petFaceCount: { type: S.INTEGER, allowNull: false, defaultValue: 1 },
        comment: { type: S.TEXT, allowNull: false, defaultValue: "" }, quantity: { type: S.INTEGER, allowNull: false, defaultValue: 1 },
        privacyConsentAt: { type: S.DATE, allowNull: false },
        deletedAt: { type: S.DATE, allowNull: true }, filesPurgedAt: { type: S.DATE, allowNull: true }, createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
      }, { transaction });
      await q.addIndex("cart_items", ["cartId", "requestKey"], { name: "cart_items_request_uq", unique: true, transaction });
      await q.addIndex("cart_items", ["cartId", "deletedAt"], { name: "cart_items_cart_idx", transaction });
      await q.addIndex("cart_items", ["deletedAt", "filesPurgedAt"], { name: "cart_items_cleanup_idx", transaction });
      await q.sequelize.query('ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_values_check" CHECK ("quantity" BETWEEN 1 AND 20 AND "patronusCount" BETWEEN 1 AND 4 AND "petFaceCount" BETWEEN 1 AND 5 AND "embroideryType" IN (\'Patronus\',\'Car\',\'petFace\'))', { transaction });
    });
  },
  async down(q) {
    await withMigrationTransaction(q, async (transaction) => {
      await assertMigrationCanRevert(q, NAME, transaction);
      await q.dropTable("cart_items", { transaction });
    });
  },
};
