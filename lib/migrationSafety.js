const { QueryTypes } = require("sequelize");

const BASELINE_TABLE = "SequelizeBaseline";

const normalizeTableName = (table) =>
  typeof table === "string" ? table : table?.tableName;

const tableExists = async (queryInterface, tableName) => {
  const tables = await queryInterface.showAllTables();
  return tables.map(normalizeTableName).includes(tableName);
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
  normalizeTableName,
  tableExists,
  withMigrationTransaction,
};
