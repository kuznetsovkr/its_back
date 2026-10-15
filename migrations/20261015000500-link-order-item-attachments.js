const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261015000500-link-order-item-attachments.js";
module.exports = {
  baseline: { tableName: "order_attachments", mode: "alter", columns: ["orderItemId"] },
  up: (q, S) => withMigrationTransaction(q, (transaction) => q.addColumn("order_attachments", "orderItemId", { type: S.INTEGER, allowNull: true, references: { model: "order_items", key: "id" }, onDelete: "SET NULL" }, { transaction })),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    const [rows] = await q.sequelize.query('SELECT 1 FROM "order_attachments" WHERE "orderItemId" IS NOT NULL LIMIT 1', { transaction });
    if (rows.length) throw new Error("Cannot erase photo-to-item mapping for existing orders");
    await q.removeColumn("order_attachments", "orderItemId", { transaction });
  }),
};
