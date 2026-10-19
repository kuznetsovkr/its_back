const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261019000500-confirm-cdek-packaging-and-money.js";
module.exports = {
  baseline: { tableName: "orders", mode: "alter", columns: ["totalPrice"], alwaysRun: true },
  up: (q, S) => withMigrationTransaction(q, async transaction => {
    // Freeze legacy single-item shipments BEFORE changing catalog dimensions.
    // Paid amounts and already saved cart packages are never rewritten.
    await q.sequelize.query(`UPDATE order_shipments AS s SET packages = jsonb_build_array(jsonb_build_object(
      'number', 'order-' || s."orderId" || '-1', 'length', t."packageLength", 'width', t."packageWidth",
      'height', t."packageHeight", 'weight', t."packageWeight", 'items', jsonb_build_array(jsonb_build_object(
        'name', o."productType", 'ware_key', 'ORDER-' || o.id, 'cost', s."declaredValue",
        'payment', jsonb_build_object('value', 0), 'weight', t."packageWeight", 'amount', 1))))
      FROM orders o JOIN inventories i ON i.id = o."inventoryId" JOIN "clothingTypes" t ON t.id = i."clothingTypeId"
      WHERE s."orderId" = o.id AND s.packages IS NULL AND o."isCartOrder" = false`, { transaction });
    await q.changeColumn("orders", "totalPrice", { type: S.DECIMAL(12, 2), allowNull: true }, { transaction });
    for (const [code, length, width, height, weight] of [["hoodie", 35, 35, 7, 800], ["svitshot", 35, 35, 7, 800], ["tshirt", 30, 25, 3, 300]]) {
      await q.bulkUpdate("clothingTypes", { packageLength: length, packageWidth: width, packageHeight: height, packageWeight: weight }, { code }, { transaction });
    }
  }),
  down: (q, S) => withMigrationTransaction(q, async transaction => {
    await assertMigrationCanRevert(q, NAME, transaction);
    const [rows] = await q.sequelize.query(`SELECT id FROM orders WHERE "totalPrice" != trunc("totalPrice") OR "totalPrice" > 2147483647 LIMIT 1`, { transaction });
    if (rows.length) throw new Error("Orders contain kopecks; use a forward fix instead of rounding financial data");
    await q.changeColumn("orders", "totalPrice", { type: S.INTEGER, allowNull: true }, { transaction });
    for (const [code, length, width, height] of [["hoodie", 7, 35, 35], ["svitshot", 7, 35, 35], ["tshirt", 3, 30, 20]]) {
      await q.bulkUpdate("clothingTypes", { packageLength: length, packageWidth: width, packageHeight: height }, { code }, { transaction });
    }
    // Immutable shipment snapshots are deliberately retained.
  }),
};
