require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { DataTypes, QueryTypes } = require("sequelize");
const sequelize = require("../db");
const {
  BASELINE_TABLE,
  inspectMigrationBaseline,
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
    const result = await inspectMigrationBaseline(
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
