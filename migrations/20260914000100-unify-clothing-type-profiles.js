const { QueryTypes } = require("sequelize");
const {
  assertMigrationCanRevert,
  withMigrationTransaction,
} = require("../lib/migrationSafety");

const MIGRATION_NAME = "20260914000100-unify-clothing-type-profiles.js";
const CLOTHING_TABLE = "clothingTypes";
const PRICING_TABLE = "pricing_configs";

const LEGACY_PRICE_FIELDS = [
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

const DEFAULT_LEGACY_PRICES = {
  patronusTshirtPrice: 8500,
  patronusSvitshotPrice: 9500,
  patronusHoodiePrice: 10000,
  carTshirtPrice: 6500,
  carSvitshotPrice: 8000,
  carHoodiePrice: 8500,
  petFaceTshirtPrice: 6000,
  petFaceSvitshotPrice: 7000,
  petFaceHoodiePrice: 8000,
};

const PROFILES = {
  tshirt: {
    displayOrder: 10,
    sizeGuideKey: "tshirt",
    patronusLimit: 1,
    packageWidth: 30,
    packageHeight: 20,
    packageLength: 3,
    packageWeight: 300,
    priceFields: {
      patronusPrice: "patronusTshirtPrice",
      carPrice: "carTshirtPrice",
      petFacePrice: "petFaceTshirtPrice",
    },
  },
  hoodie: {
    displayOrder: 20,
    sizeGuideKey: "hoodie",
    patronusLimit: 5,
    packageWidth: 35,
    packageHeight: 35,
    packageLength: 7,
    packageWeight: 800,
    priceFields: {
      patronusPrice: "patronusHoodiePrice",
      carPrice: "carHoodiePrice",
      petFacePrice: "petFaceHoodiePrice",
    },
  },
  svitshot: {
    displayOrder: 30,
    sizeGuideKey: "svitshot",
    patronusLimit: 5,
    packageWidth: 35,
    packageHeight: 35,
    packageLength: 7,
    packageWeight: 800,
    priceFields: {
      patronusPrice: "patronusSvitshotPrice",
      carPrice: "carSvitshotPrice",
      petFacePrice: "petFaceSvitshotPrice",
    },
  },
};

const detectLegacyProfile = (name) => {
  const normalized = String(name || "").trim().toLowerCase().replaceAll("ё", "е");
  if (/худи|hoodie|hudi/.test(normalized)) return "hoodie";
  if (/свитшот|лонгслив|sweatshirt|svitshot|long\s?sleeve/.test(normalized)) return "svitshot";
  if (/футбол|t-shirt|tshirt|\btee\b/.test(normalized)) return "tshirt";
  return null;
};

const addProfileConstraints = async (queryInterface, Sequelize, transaction) => {
  for (const field of [
    "displayOrder",
    "patronusLimit",
    "packageWidth",
    "packageHeight",
    "packageLength",
    "packageWeight",
  ]) {
    await queryInterface.addConstraint(CLOTHING_TABLE, {
      fields: [field],
      type: "check",
      name: `clothing_types_${field}_positive_ck`,
      where: { [field]: { [Sequelize.Op.gt]: 0 } },
      transaction,
    });
  }

  for (const field of ["patronusPrice", "carPrice", "petFacePrice"]) {
    await queryInterface.addConstraint(CLOTHING_TABLE, {
      fields: [field],
      type: "check",
      name: `clothing_types_${field}_positive_ck`,
      where: { [field]: { [Sequelize.Op.gt]: 0 } },
      transaction,
    });
  }
};

module.exports = {
  baseline: {
    tableName: CLOTHING_TABLE,
    mode: "alter",
    columns: [
      "code",
      "displayOrder",
      "sizeGuideKey",
      "patronusLimit",
      "packageWidth",
      "packageHeight",
      "packageLength",
      "packageWeight",
      "patronusPrice",
      "carPrice",
      "petFacePrice",
    ],
    indexes: [{ unique: true, fields: ["code"] }],
  },

  async up(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      const positiveInteger = (defaultValue) => ({
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue,
      });
      const optionalPrice = { type: Sequelize.INTEGER, allowNull: true };

      await queryInterface.addColumn(CLOTHING_TABLE, "code", {
        type: Sequelize.STRING(64),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "displayOrder", positiveInteger(100), { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "sizeGuideKey", {
        type: Sequelize.STRING(32),
        allowNull: true,
      }, { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "patronusLimit", positiveInteger(5), { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "packageWidth", positiveInteger(35), { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "packageHeight", positiveInteger(35), { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "packageLength", positiveInteger(7), { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "packageWeight", positiveInteger(800), { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "patronusPrice", optionalPrice, { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "carPrice", optionalPrice, { transaction });
      await queryInterface.addColumn(CLOTHING_TABLE, "petFacePrice", optionalPrice, { transaction });

      const [pricingConfig] = await queryInterface.sequelize.query(
        `SELECT * FROM "${PRICING_TABLE}" WHERE "id" = 1 LIMIT 1`,
        { type: QueryTypes.SELECT, transaction }
      );
      const types = await queryInterface.sequelize.query(
        `SELECT "id", "name" FROM "${CLOTHING_TABLE}" ORDER BY "id" ASC`,
        { type: QueryTypes.SELECT, transaction }
      );
      const usedCodes = new Set();

      for (const type of types) {
        const legacyKey = detectLegacyProfile(type.name);
        const profile = legacyKey ? PROFILES[legacyKey] : null;
        let code = legacyKey || `type-${type.id}`;
        if (usedCodes.has(code)) code = `${code}-${type.id}`;
        usedCodes.add(code);

        const values = {
          code,
          displayOrder: profile?.displayOrder ?? 100 + Number(type.id),
          sizeGuideKey: profile?.sizeGuideKey ?? null,
          patronusLimit: profile?.patronusLimit ?? 5,
          packageWidth: profile?.packageWidth ?? 35,
          packageHeight: profile?.packageHeight ?? 35,
          packageLength: profile?.packageLength ?? 7,
          packageWeight: profile?.packageWeight ?? 800,
        };
        if (profile && pricingConfig) {
          for (const [target, source] of Object.entries(profile.priceFields)) {
            values[target] = pricingConfig[source];
          }
        }
        await queryInterface.bulkUpdate(CLOTHING_TABLE, values, { id: type.id }, { transaction });
      }

      await queryInterface.changeColumn(CLOTHING_TABLE, "code", {
        type: Sequelize.STRING(64),
        allowNull: false,
      }, { transaction });
      await queryInterface.addIndex(CLOTHING_TABLE, ["code"], {
        name: "clothing_types_code_uq",
        unique: true,
        transaction,
      });
      await addProfileConstraints(queryInterface, Sequelize, transaction);

      for (const field of LEGACY_PRICE_FIELDS) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "${PRICING_TABLE}" DROP CONSTRAINT IF EXISTS "pricing_configs_${field}_positive_ck"`,
          { transaction }
        );
        await queryInterface.removeColumn(PRICING_TABLE, field, { transaction });
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await withMigrationTransaction(queryInterface, async (transaction) => {
      await assertMigrationCanRevert(queryInterface, MIGRATION_NAME, transaction);

      for (const field of LEGACY_PRICE_FIELDS) {
        await queryInterface.addColumn(PRICING_TABLE, field, {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: DEFAULT_LEGACY_PRICES[field],
        }, { transaction });
      }

      const types = await queryInterface.sequelize.query(
        `SELECT * FROM "${CLOTHING_TABLE}" WHERE "code" IN ('tshirt', 'svitshot', 'hoodie')`,
        { type: QueryTypes.SELECT, transaction }
      );
      const restored = { ...DEFAULT_LEGACY_PRICES };
      for (const type of types) {
        const profile = PROFILES[type.code];
        if (!profile) continue;
        for (const [source, target] of Object.entries(profile.priceFields)) {
          if (Number.isInteger(type[source]) && type[source] > 0) restored[target] = type[source];
        }
      }
      await queryInterface.bulkUpdate(PRICING_TABLE, restored, { id: 1 }, { transaction });

      for (const field of LEGACY_PRICE_FIELDS) {
        await queryInterface.addConstraint(PRICING_TABLE, {
          fields: [field],
          type: "check",
          name: `pricing_configs_${field}_positive_ck`,
          where: { [field]: { [Sequelize.Op.gt]: 0 } },
          transaction,
        });
      }

      for (const field of [
        "displayOrder",
        "patronusLimit",
        "packageWidth",
        "packageHeight",
        "packageLength",
        "packageWeight",
        "patronusPrice",
        "carPrice",
        "petFacePrice",
      ]) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "${CLOTHING_TABLE}" DROP CONSTRAINT IF EXISTS "clothing_types_${field}_positive_ck"`,
          { transaction }
        );
      }
      await queryInterface.removeIndex(CLOTHING_TABLE, "clothing_types_code_uq", { transaction });
      for (const field of [
        "petFacePrice",
        "carPrice",
        "patronusPrice",
        "packageWeight",
        "packageLength",
        "packageHeight",
        "packageWidth",
        "patronusLimit",
        "sizeGuideKey",
        "displayOrder",
        "code",
      ]) {
        await queryInterface.removeColumn(CLOTHING_TABLE, field, { transaction });
      }
    });
  },
};
