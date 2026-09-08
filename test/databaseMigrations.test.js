const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const sequelize = require("../db");
const { assertMigrationCanRevert } = require("../lib/migrationSafety");
const {
  assertDatabaseMigrationsCurrent,
  getMigrationNames,
} = require("../services/databaseMigrations");

const MODELS_DIRECTORY = path.resolve(__dirname, "..", "models");
const MIGRATIONS_DIRECTORY = path.resolve(__dirname, "..", "migrations");

test("migration baseline columns match every active Sequelize model", () => {
  for (const file of fs.readdirSync(MODELS_DIRECTORY)) {
    if (file.endsWith(".js")) require(path.join(MODELS_DIRECTORY, file));
  }

  const migrationTables = new Map();
  for (const name of getMigrationNames()) {
    const migration = require(path.join(MIGRATIONS_DIRECTORY, name));
    assert.equal(typeof migration.up, "function", `${name} must provide up()`);
    assert.equal(typeof migration.down, "function", `${name} must provide down()`);
    assert.ok(migration.baseline?.tableName, `${name} must provide baseline metadata`);
    assert.equal(
      migrationTables.has(migration.baseline.tableName),
      false,
      `duplicate migration table ${migration.baseline.tableName}`
    );
    migrationTables.set(
      migration.baseline.tableName,
      [...migration.baseline.columns].sort()
    );
  }

  const modelTables = new Map(
    Object.values(sequelize.models).map((model) => [
      typeof model.getTableName() === "string"
        ? model.getTableName()
        : model.getTableName().tableName,
      Object.keys(model.getAttributes()).sort(),
    ])
  );

  assert.deepEqual([...migrationTables.keys()].sort(), [...modelTables.keys()].sort());
  for (const [tableName, columns] of modelTables) {
    assert.deepEqual(
      migrationTables.get(tableName),
      columns,
      `migration columns differ from model ${tableName}`
    );
  }
});

test("server startup gate rejects a database without migration metadata", async () => {
  const fakeSequelize = {
    getQueryInterface: () => ({
      showAllTables: async () => ["orders"],
    }),
  };

  await assert.rejects(
    assertDatabaseMigrationsCurrent(fakeSequelize),
    /Database migrations are not initialized/
  );
});

test("server startup gate accepts a fully migrated database", async () => {
  const names = getMigrationNames();
  const fakeSequelize = {
    getQueryInterface: () => ({
      showAllTables: async () => ["SequelizeMeta"],
      queryGenerator: {
        quoteTable: (value) => `"${value}"`,
        quoteIdentifier: (value) => `"${value}"`,
      },
    }),
    query: async () => names.map((name) => ({ name })),
  };

  await assert.doesNotReject(assertDatabaseMigrationsCurrent(fakeSequelize));
});

test("baseline-adopted migrations cannot drop pre-existing tables", async () => {
  const queryInterface = {
    showAllTables: async () => ["SequelizeBaseline"],
    queryGenerator: {
      quoteTable: (value) => `"${value}"`,
      quoteIdentifier: (value) => `"${value}"`,
    },
    sequelize: {
      query: async () => [{ name: "20260908001000-create-order-shipments.js" }],
    },
  };

  await assert.rejects(
    assertMigrationCanRevert(
      queryInterface,
      "20260908001000-create-order-shipments.js"
    ),
    /cannot be reverted safely/
  );
});
