const { assertMigrationCanRevert, withMigrationTransaction } = require("../lib/migrationSafety");
const NAME = "20261004000600-add-order-certificate-payment.js";
const columns = ["merchandiseAmountKopecks", "deliveryAmountKopecks", "certificateDiscountKopecks", "amountDueKopecks", "paymentTestMode", "certificateId"];
module.exports = {
  baseline: { tableName: "orders", mode: "alter", columns },
  async up(q, S) {
    await withMigrationTransaction(q, async (transaction) => {
      for (const name of columns.slice(0, 4)) {
        await q.addColumn("orders", name, { type: S.INTEGER, allowNull: true }, { transaction });
      }
      await q.addColumn("orders", "paymentTestMode", { type: S.BOOLEAN, allowNull: true }, { transaction });
      await q.addColumn("orders", "certificateId", { type: S.INTEGER, allowNull: true, references: { model: "gift_certificates", key: "id" }, onDelete: "RESTRICT" }, { transaction });
      await q.sequelize.query(`ALTER TABLE "orders" ADD CONSTRAINT "order_certificate_payment_check" CHECK (
        ("merchandiseAmountKopecks" IS NULL AND "deliveryAmountKopecks" IS NULL AND "certificateDiscountKopecks" IS NULL AND "amountDueKopecks" IS NULL AND "paymentTestMode" IS NULL AND "certificateId" IS NULL)
        OR ("merchandiseAmountKopecks" IS NOT NULL AND "merchandiseAmountKopecks" > 0 AND "deliveryAmountKopecks" IS NOT NULL AND "deliveryAmountKopecks" >= 0
          AND "certificateDiscountKopecks" IS NOT NULL AND "certificateDiscountKopecks" BETWEEN 0 AND "merchandiseAmountKopecks"
          AND "amountDueKopecks" IS NOT NULL AND "amountDueKopecks" = "merchandiseAmountKopecks"::bigint + "deliveryAmountKopecks"::bigint - "certificateDiscountKopecks"::bigint
          AND "paymentTestMode" IS NOT NULL AND (("certificateId" IS NULL AND "certificateDiscountKopecks" = 0) OR ("certificateId" IS NOT NULL AND "certificateDiscountKopecks" > 0)))
      )`, { transaction });
    });
  },
  async down(q) {
    await withMigrationTransaction(q, async (transaction) => {
      await assertMigrationCanRevert(q, NAME, transaction);
      await q.sequelize.query('ALTER TABLE "orders" DROP CONSTRAINT "order_certificate_payment_check"', { transaction });
      for (const name of [...columns].reverse()) await q.removeColumn("orders", name, { transaction });
    });
  },
};
