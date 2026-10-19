const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261019000300-add-cart-item-car-design.js";
module.exports = {
  baseline: { tableName: "cart_items", mode: "alter", columns: ["carDesign"] },
  up: (q, S) => withMigrationTransaction(q, async (transaction) => {
    await q.addColumn("cart_items", "carDesign", { type: S.STRING(16), allowNull: true }, { transaction });
    await q.addConstraint("cart_items", { fields: ["carDesign"], type: "check", name: "cart_items_car_design_ck",
      where: { carDesign: { [S.Op.in]: ["simple", "medium", "complex"] } }, transaction });
  }),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    await q.removeColumn("cart_items", "carDesign", { transaction });
  }),
};
