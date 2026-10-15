const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261015000400-add-cart-checkout-state.js";
module.exports = {
  baseline: { tableName: "carts", mode: "alter", columns: ["revision", "checkoutOrderId"] },
  up: (q, S) => withMigrationTransaction(q, async (transaction) => {
    await q.addColumn("carts", "revision", { type: S.INTEGER, allowNull: false, defaultValue: 0 }, { transaction });
    await q.addColumn("carts", "checkoutOrderId", { type: S.INTEGER, allowNull: true, references: { model: "orders", key: "id" }, onDelete: "SET NULL" }, { transaction });
  }),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    await q.removeColumn("carts", "checkoutOrderId", { transaction }); await q.removeColumn("carts", "revision", { transaction });
  }),
};
