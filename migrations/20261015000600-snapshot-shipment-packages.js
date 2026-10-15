const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261015000600-snapshot-shipment-packages.js";
module.exports = {
  baseline: { tableName: "order_shipments", mode: "alter", columns: ["packages"] },
  up: (q, S) => withMigrationTransaction(q, (transaction) => q.addColumn("order_shipments", "packages", { type: S.JSONB, allowNull: true }, { transaction })),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    const [rows] = await q.sequelize.query('SELECT 1 FROM "order_shipments" WHERE "packages" IS NOT NULL LIMIT 1', { transaction });
    if (rows.length) throw new Error("Cannot erase package snapshots for existing shipments");
    await q.removeColumn("order_shipments", "packages", { transaction });
  }),
};
