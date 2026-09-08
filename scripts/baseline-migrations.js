require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { DataTypes, QueryTypes } = require("sequelize");
const sequelize = require("../db");
const {
  BASELINE_TABLE,
  normalizeTableName,
} = require("../lib/migrationSafety");
const { getMigrationNames } = require("../services/databaseMigrations");

const MIGRATIONS_DIRECTORY = path.resolve(__dirname, "..", "migrations");
const META_TABLE = "SequelizeMeta";
const apply = process.argv.includes("--apply");

const loadMigration = (name) => {
  const migrationPath = path.join(MIGRATIONS_DIRECTORY, name);
  if (!fs.existsSync(migrationPath)) throw new Error(`Migration not found: ${name}`);
  return require(migrationPath);
};

const hasMatchingIndex = (indexes, expected) => indexes.some((index) => {
  const fields = index.fields.map((field) => field.attribute || field.name);
  return Boolean(index.unique) === Boolean(expected.unique) &&
    fields.length === expected.fields.length &&
    fields.every((field, position) => field === expected.fields[position]);
});

const inspectExistingMigration = async (queryInterface, name, migration, existingTables) => {
  const baseline = migration.baseline;
  if (!baseline?.tableName || !Array.isArray(baseline.columns)) {
    throw new Error(`Migration ${name} does not declare baseline metadata`);
  }
  if (!existingTables.has(baseline.tableName)) return { state: "pending" };

  const description = await queryInterface.describeTable(baseline.tableName);
  const missingColumns = baseline.columns.filter((column) => !description[column]);
  if (missingColumns.length > 0) {
    throw new Error(
      `Existing table ${baseline.tableName} is incompatible with ${name}; missing columns: ${missingColumns.join(", ")}`
    );
  }

  const indexes = await queryInterface.showIndex(baseline.tableName);
  const missingIndexes = (baseline.indexes || []).filter(
    (expected) => !hasMatchingIndex(indexes, expected)
  );
  if (missingIndexes.length > 0) {
    throw new Error(
      `Existing table ${baseline.tableName} is incompatible with ${name}; required indexes are missing`
    );
  }

  return { state: "adopt" };
};

const ensureMetadataTables = async (queryInterface, existingTables, transaction) => {
  if (!existingTables.has(META_TABLE)) {
    await queryInterface.createTable(META_TABLE, {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        primaryKey: true,
      },
    }, { transaction });
  }
  if (!existingTables.has(BASELINE_TABLE)) {
    await queryInterface.createTable(BASELINE_TABLE, {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        primaryKey: true,
      },
      adoptedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      },
    }, { transaction });
  }
};

const run = async () => {
  await sequelize.authenticate();
  const queryInterface = sequelize.getQueryInterface();
  const existingTables = new Set(
    (await queryInterface.showAllTables()).map(normalizeTableName)
  );
  const applied = existingTables.has(META_TABLE)
    ? new Set((await sequelize.query(
        `SELECT "name" FROM ${queryInterface.queryGenerator.quoteTable(META_TABLE)}`,
        { type: QueryTypes.SELECT }
      )).map((row) => row.name))
    : new Set();

  const adopt = [];
  const pending = [];
  for (const name of getMigrationNames()) {
    if (applied.has(name)) continue;
    const result = await inspectExistingMigration(
      queryInterface,
      name,
      loadMigration(name),
      existingTables
    );
    if (result.state === "adopt") adopt.push(name);
    else pending.push(name);
  }

  console.log(`[baseline] Existing migrations to adopt: ${adopt.length}`);
  adopt.forEach((name) => console.log(`[baseline]   adopt ${name}`));
  console.log(`[baseline] Migrations left pending: ${pending.length}`);
  pending.forEach((name) => console.log(`[baseline]   pending ${name}`));

  if (!apply) {
    console.log("[baseline] Dry run only. Add --apply to write migration metadata.");
    return;
  }

  await sequelize.transaction(async (transaction) => {
    await ensureMetadataTables(queryInterface, existingTables, transaction);
    const now = new Date();
    for (const name of adopt) {
      await queryInterface.bulkInsert(META_TABLE, [{ name }], { transaction });
      await queryInterface.bulkInsert(
        BASELINE_TABLE,
        [{ name, adoptedAt: now }],
        { transaction }
      );
    }
  });
  console.log("[baseline] Existing schema adopted. Run npm run db:migrate next.");
};

run()
  .catch((error) => {
    console.error("[baseline] Failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
