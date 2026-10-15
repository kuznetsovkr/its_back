const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261015000300-create-cart-checkouts.js";
module.exports = {
  baseline: { tableName: "cart_checkouts", columns: ["id", "cartId", "orderId", "requestHash", "createdAt", "updatedAt"], indexes: [{ unique: true, fields: ["orderId"] }, { unique: false, fields: ["cartId"] }] },
  up: (q, S) => withMigrationTransaction(q, async (transaction) => {
    await q.createTable("cart_checkouts", {
      id: { type: S.UUID, primaryKey: true, allowNull: false },
      cartId: { type: S.UUID, allowNull: true, references: { model: "carts", key: "id" }, onDelete: "SET NULL" },
      orderId: { type: S.INTEGER, allowNull: false, references: { model: "orders", key: "id" }, onDelete: "CASCADE" },
      requestHash: { type: S.STRING(64), allowNull: false }, createdAt: { type: S.DATE, allowNull: false }, updatedAt: { type: S.DATE, allowNull: false },
    }, { transaction });
    await q.addIndex("cart_checkouts", ["orderId"], { unique: true, name: "cart_checkouts_order_uq", transaction });
    await q.addIndex("cart_checkouts", ["cartId"], { name: "cart_checkouts_cart_idx", transaction });
  }),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    const [rows] = await q.sequelize.query('SELECT 1 FROM "cart_checkouts" LIMIT 1', { transaction });
    if (rows.length) throw new Error("Cannot erase checkout idempotency records for existing orders");
    await q.dropTable("cart_checkouts", { transaction });
  }),
};
