const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261015000700-reserve-multiple-inventory-items.js";
module.exports = {
  baseline: { tableName: "inventory_reservations", mode: "alter", columns: ["orderId", "inventoryId"], indexes: [{ unique: true, fields: ["orderId", "inventoryId"] }] },
  up: (q) => withMigrationTransaction(q, async (transaction) => {
    await q.removeIndex("inventory_reservations", "inventory_reservations_order_uq", { transaction });
    await q.addIndex("inventory_reservations", ["orderId", "inventoryId"], { name: "inventory_reservations_order_inventory_uq", unique: true, transaction });
  }),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    const [rows] = await q.sequelize.query('SELECT "orderId" FROM "inventory_reservations" GROUP BY "orderId" HAVING COUNT(*) > 1 LIMIT 1', { transaction });
    if (rows.length) throw new Error("Cannot collapse multiple reservations of existing orders");
    await q.removeIndex("inventory_reservations", "inventory_reservations_order_inventory_uq", { transaction });
    await q.addIndex("inventory_reservations", ["orderId"], { name: "inventory_reservations_order_uq", unique: true, transaction });
  }),
};
