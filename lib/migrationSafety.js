const { QueryTypes } = require("sequelize");

const BASELINE_TABLE = "SequelizeBaseline";

const normalizeTableName = (table) =>
  typeof table === "string" ? table : table?.tableName;

const tableExists = async (queryInterface, tableName) => {
  const tables = await queryInterface.showAllTables();
  return tables.map(normalizeTableName).includes(tableName);
};

const hasMatchingIndex = (indexes, expected) => indexes.some((index) => {
  const fields = index.fields.map((field) => field.attribute || field.name);
  return Boolean(index.unique) === Boolean(expected.unique) &&
    fields.length === expected.fields.length &&
    fields.every((field, position) => field === expected.fields[position]);
});

const inspectMigrationBaseline = async (
  queryInterface,
  name,
  migration,
  existingTables
) => {
  const baseline = migration.baseline;
  if (!baseline?.tableName || !Array.isArray(baseline.columns)) {
    throw new Error(`Migration ${name} does not declare baseline metadata`);
  }
  if (!existingTables.has(baseline.tableName)) return { state: "pending" };

  const description = await queryInterface.describeTable(baseline.tableName);
  const missingColumns = baseline.columns.filter((column) => !description[column]);
  if (missingColumns.length > 0) {
    if (baseline.mode === "alter") return { state: "pending" };
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

const assertMigrationCanRevert = async (queryInterface, migrationName, transaction) => {
  if (!(await tableExists(queryInterface, BASELINE_TABLE))) return;

  const quotedTable = queryInterface.queryGenerator.quoteTable(BASELINE_TABLE);
  const quotedName = queryInterface.queryGenerator.quoteIdentifier("name");
  const adopted = await queryInterface.sequelize.query(
    `SELECT ${quotedName} FROM ${quotedTable} WHERE ${quotedName} = :migrationName LIMIT 1`,
    {
      replacements: { migrationName },
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  if (adopted.length > 0) {
    throw new Error(
      `Migration ${migrationName} was adopted as an existing baseline and cannot be reverted safely`
    );
  }
};

const withMigrationTransaction = (queryInterface, callback) =>
  queryInterface.sequelize.transaction(callback);

module.exports = {
  BASELINE_TABLE,
  assertMigrationCanRevert,
  inspectMigrationBaseline,
  normalizeTableName,
  tableExists,
  withMigrationTransaction,
};
