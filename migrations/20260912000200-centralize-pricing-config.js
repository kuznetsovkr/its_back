const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260912000200-centralize-pricing-config.js";
const TABLE = "pricing_configs";

module.exports = {
  baseline: {
    tableName: TABLE,
    columns: [
      "id",
      "patronusTshirtPrice",
      "patronusSvitshotPrice",
      "patronusHoodiePrice",
      "carTshirtPrice",
      "carSvitshotPrice",
      "carHoodiePrice",
      "petFaceTshirtPrice",
      "petFaceSvitshotPrice",
      "petFaceHoodiePrice",
      "additionalPatronusPrice",
      "additionalPetFacePrice",
      "createdAt",
      "updatedAt",
    ],
  },

  async up(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      const positivePrice = () => ({ type: Sequelize.INTEGER, allowNull: false });
      const nonNegativePrice = () => ({ type: Sequelize.INTEGER, allowNull: false });

      await queryInterface.createTable(TABLE, {
        id: {
          type: Sequelize.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        patronusTshirtPrice: positivePrice(),
        patronusSvitshotPrice: positivePrice(),
        patronusHoodiePrice: positivePrice(),
        carTshirtPrice: positivePrice(),
        carSvitshotPrice: positivePrice(),
        carHoodiePrice: positivePrice(),
        petFaceTshirtPrice: positivePrice(),
        petFaceSvitshotPrice: positivePrice(),
        petFaceHoodiePrice: positivePrice(),
        additionalPatronusPrice: nonNegativePrice(),
        additionalPetFacePrice: nonNegativePrice(),
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });

      await queryInterface.addConstraint(TABLE, {
        fields: ["id"],
        type: "check",
        name: "pricing_configs_singleton_ck",
        where: { id: 1 },
        transaction,
      });

      const positiveFields = [
        "patronusTshirtPrice",
        "patronusSvitshotPrice",
        "patronusHoodiePrice",
        "carTshirtPrice",
        "carSvitshotPrice",
        "carHoodiePrice",
        "petFaceTshirtPrice",
        "petFaceSvitshotPrice",
        "petFaceHoodiePrice",
      ];
      for (const field of positiveFields) {
        await queryInterface.addConstraint(TABLE, {
          fields: [field],
          type: "check",
          name: `pricing_configs_${field}_positive_ck`,
          where: { [field]: { [Sequelize.Op.gt]: 0 } },
          transaction,
        });
      }
      for (const field of ["additionalPatronusPrice", "additionalPetFacePrice"]) {
        await queryInterface.addConstraint(TABLE, {
          fields: [field],
          type: "check",
          name: `pricing_configs_${field}_non_negative_ck`,
          where: { [field]: { [Sequelize.Op.gte]: 0 } },
          transaction,
        });
      }

      const now = new Date();
      await queryInterface.bulkInsert(TABLE, [{
        id: 1,
        patronusTshirtPrice: 8500,
        patronusSvitshotPrice: 9500,
        patronusHoodiePrice: 10000,
        carTshirtPrice: 6500,
        carSvitshotPrice: 8000,
        carHoodiePrice: 8500,
        petFaceTshirtPrice: 6000,
        petFaceSvitshotPrice: 7000,
        petFaceHoodiePrice: 8000,
        additionalPatronusPrice: 5000,
        additionalPetFacePrice: 2000,
        createdAt: now,
        updatedAt: now,
      }], { transaction });

      await queryInterface.removeColumn("clothingTypes", "price", { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, MIGRATION_NAME, transaction);
      await queryInterface.addColumn("clothingTypes", "price", {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      }, { transaction });
      await queryInterface.dropTable(TABLE, { transaction });
    });
  },
};
