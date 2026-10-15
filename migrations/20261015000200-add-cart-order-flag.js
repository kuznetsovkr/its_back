const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261015000200-add-cart-order-flag.js";
module.exports = {
  baseline: { tableName: "orders", mode: "alter", columns: ["isCartOrder"] },
  up: (q, S) => withMigrationTransaction(q, (transaction) => q.addColumn("orders", "isCartOrder", { type: S.BOOLEAN, allowNull: false, defaultValue: false }, { transaction })),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    const [rows] = await q.sequelize.query('SELECT 1 FROM "orders" WHERE "isCartOrder" = true LIMIT 1', { transaction });
    if (rows.length) throw new Error("Cannot erase the identity of existing cart orders");
    await q.removeColumn("orders", "isCartOrder", { transaction });
  }),
};
