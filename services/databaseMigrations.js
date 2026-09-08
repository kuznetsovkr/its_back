const fs = require("node:fs");
const path = require("node:path");
const { QueryTypes } = require("sequelize");
const { normalizeTableName } = require("../lib/migrationSafety");

const MIGRATIONS_DIRECTORY = path.resolve(__dirname, "..", "migrations");
const META_TABLE = "SequelizeMeta";

const getMigrationNames = () =>
  fs.readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => /^\d+.*\.js$/.test(name))
    .sort();

const assertDatabaseMigrationsCurrent = async (sequelize) => {
  const queryInterface = sequelize.getQueryInterface();
  const tables = (await queryInterface.showAllTables()).map(normalizeTableName);
  if (!tables.includes(META_TABLE)) {
    throw new Error(
      "Database migrations are not initialized. Run npm run db:migrate for a new database or npm run db:migrate:baseline:apply for an existing database"
    );
  }

  const quotedTable = queryInterface.queryGenerator.quoteTable(META_TABLE);
  const quotedName = queryInterface.queryGenerator.quoteIdentifier("name");
  const rows = await sequelize.query(`SELECT ${quotedName} FROM ${quotedTable}`, {
    type: QueryTypes.SELECT,
  });
  const applied = new Set(rows.map((row) => row.name));
  const pending = getMigrationNames().filter((name) => !applied.has(name));
  if (pending.length > 0) {
    throw new Error(
      `Database has pending migrations: ${pending.join(", ")}. Run npm run db:migrate before starting the server`
    );
  }
};

module.exports = {
  assertDatabaseMigrationsCurrent,
  getMigrationNames,
};
