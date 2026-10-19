const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261019000400-add-order-item-car-design.js";
module.exports = {
  baseline: { tableName: "order_items", mode: "alter", columns: ["carDesign"] },
  up: (q, S) => withMigrationTransaction(q, async (transaction) => {
    await q.addColumn("order_items", "carDesign", { type: S.STRING(16), allowNull: true }, { transaction });
    await q.addConstraint("order_items", { fields: ["carDesign"], type: "check", name: "order_items_car_design_ck",
      where: { carDesign: { [S.Op.in]: ["simple", "medium", "complex"] } }, transaction });
  }),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    await q.removeColumn("order_items", "carDesign", { transaction });
  }),
};
