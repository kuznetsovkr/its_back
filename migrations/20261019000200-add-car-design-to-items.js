const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261019000200-add-car-design-to-items.js";
module.exports = {
  baseline: { tableName: "orders", mode: "alter", columns: ["carDesign"] },
  up: (q, S) => withMigrationTransaction(q, async (transaction) => {
    for (const table of ["orders"]) {
      await q.addColumn(table, "carDesign", { type: S.STRING(16), allowNull: true }, { transaction });
      await q.addConstraint(table, { fields: ["carDesign"], type: "check", name: `${table}_car_design_ck`,
        where: { carDesign: { [S.Op.in]: ["simple", "medium", "complex"] } }, transaction });
    }
  }),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    await q.removeColumn("orders", "carDesign", { transaction });
  }),
};
