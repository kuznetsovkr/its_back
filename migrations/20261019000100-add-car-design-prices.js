const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261019000100-add-car-design-prices.js";
const fields = ["carSimplePrice", "carMediumPrice", "carComplexPrice"];
module.exports = {
  baseline: { tableName: "clothingTypes", mode: "alter", columns: fields },
  up: (q, S) => withMigrationTransaction(q, async (transaction) => {
    for (const field of fields) {
      await q.addColumn("clothingTypes", field, { type: S.INTEGER, allowNull: true }, { transaction });
      await q.addConstraint("clothingTypes", { fields: [field], type: "check", name: `clothing_types_${field}_positive_ck`,
        where: { [field]: { [S.Op.gt]: 0 } }, transaction });
    }
    for (const [code, simple, medium, complex] of [
      ["tshirt", 5000, 7000, null], ["svitshot", 6000, 8000, 11000], ["hoodie", 6500, 8500, 11500],
    ]) await q.bulkUpdate("clothingTypes", { carSimplePrice: simple, carMediumPrice: medium, carComplexPrice: complex }, { code }, { transaction });
    // Legacy prices, orders, invoices and cart lines are deliberately untouched.
  }),
  down: (q) => withMigrationTransaction(q, async (transaction) => {
    await assertMigrationCanRevert(q, NAME, transaction);
    for (const field of [...fields].reverse()) await q.removeColumn("clothingTypes", field, { transaction });
  }),
};
