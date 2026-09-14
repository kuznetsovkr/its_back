require("dotenv").config();
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { Sequelize } = require("sequelize");

const TEST_DATABASE_PREFIX = "its_migration_test_";
const testDatabaseName = `${TEST_DATABASE_PREFIX}${process.pid}_${Date.now()}`;
if (!new RegExp(`^${TEST_DATABASE_PREFIX}\\d+_\\d+$`).test(testDatabaseName)) {
  throw new Error("Unsafe temporary database name");
}

const connectionOptions = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  dialect: "postgres",
  logging: false,
};
const adminDatabase = process.env.DB_ADMIN_DATABASE || "postgres";
const admin = new Sequelize(
  adminDatabase,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  connectionOptions
);

const quoteDatabaseName = (name) => `"${name.replace(/"/g, "\"\"")}"`;

const runCli = (args) => {
  const cliPath = require.resolve("sequelize-cli/lib/sequelize");
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      DB_NAME: testDatabaseName,
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`sequelize-cli ${args.join(" ")} failed with code ${result.status}`);
  }
};

const getApplicationTables = async () => {
  const verification = new Sequelize(
    testDatabaseName,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    connectionOptions
  );
  try {
    const tables = await verification.getQueryInterface().showAllTables();
    return tables
      .map((table) => (typeof table === "string" ? table : table.tableName))
      .filter((table) => table !== "SequelizeMeta")
      .sort();
  } finally {
    await verification.close();
  }
};

const expectedTables = [
  "clothingTypes",
  "colors",
  "inventories",
  "inventory_reservations",
  "low_stock_alerts",
  "order_attachments",
  "order_shipments",
  "orders",
  "payment_events",
  "pricing_configs",
  "telegram_channel_subscribers",
].sort();

const assertExpectedTables = (actual) => {
  if (JSON.stringify(actual) !== JSON.stringify(expectedTables)) {
    throw new Error(
      `Unexpected migrated schema. Expected ${expectedTables.join(", ")}; received ${actual.join(", ")}`
    );
  }
};

const seedLegacyCatalog = async () => {
  const verification = new Sequelize(
    testDatabaseName,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    connectionOptions
  );
  try {
    const now = new Date();
    await verification.getQueryInterface().bulkInsert("clothingTypes", [
      { name: "Футболка", createdAt: now, updatedAt: now },
      { name: "Худи", createdAt: now, updatedAt: now },
      { name: "Свитшот", createdAt: now, updatedAt: now },
      { name: "Куртка", createdAt: now, updatedAt: now },
    ]);
    await verification.getQueryInterface().bulkUpdate("pricing_configs", {
      patronusTshirtPrice: 1111,
      patronusSvitshotPrice: 2222,
      patronusHoodiePrice: 3333,
      carTshirtPrice: 4444,
      carSvitshotPrice: 5555,
      carHoodiePrice: 6666,
      petFaceTshirtPrice: 7777,
      petFaceSvitshotPrice: 8888,
      petFaceHoodiePrice: 9999,
    }, { id: 1 });
  } finally {
    await verification.close();
  }
};

const assertCatalogProfilesMigrated = async () => {
  const verification = new Sequelize(
    testDatabaseName,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    connectionOptions
  );
  try {
    const types = await verification.query(
      `SELECT * FROM "clothingTypes" ORDER BY "id" ASC`,
      { type: Sequelize.QueryTypes.SELECT }
    );
    const byCode = new Map(types.map((type) => [type.code, type]));
    assert.equal(byCode.get("tshirt").patronusPrice, 1111);
    assert.equal(byCode.get("tshirt").packageWeight, 300);
    assert.equal(byCode.get("tshirt").patronusLimit, 1);
    assert.equal(byCode.get("svitshot").carPrice, 5555);
    assert.equal(byCode.get("hoodie").petFacePrice, 9999);

    const unknownType = types.find((type) => type.name === "Куртка");
    assert.match(unknownType.code, /^type-\d+$/);
    assert.equal(unknownType.patronusPrice, null);
    assert.equal(unknownType.sizeGuideKey, null);

    const pricingColumns = await verification.getQueryInterface().describeTable("pricing_configs");
    assert.equal(pricingColumns.patronusTshirtPrice, undefined);
    assert.ok(pricingColumns.additionalPatronusPrice);
  } finally {
    await verification.close();
  }
};

const run = async () => {
  await admin.authenticate();
  await admin.query(`CREATE DATABASE ${quoteDatabaseName(testDatabaseName)}`);
  console.log(`[migration-test] Created ${testDatabaseName}`);

  runCli(["db:migrate", "--to", "20260912000200-centralize-pricing-config.js"]);
  await seedLegacyCatalog();
  runCli(["db:migrate"]);
  assertExpectedTables(await getApplicationTables());
  await assertCatalogProfilesMigrated();

  runCli(["db:migrate:undo:all"]);
  const tablesAfterRollback = await getApplicationTables();
  if (tablesAfterRollback.length > 0) {
    throw new Error(`Rollback left application tables: ${tablesAfterRollback.join(", ")}`);
  }

  runCli(["db:migrate"]);
  assertExpectedTables(await getApplicationTables());
  console.log("[migration-test] Up, rollback and re-apply completed successfully");
};

run()
  .catch((error) => {
    console.error("[migration-test] Failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteDatabaseName(testDatabaseName)}`);
      console.log(`[migration-test] Removed ${testDatabaseName}`);
    } catch (error) {
      console.error(`[migration-test] Could not remove ${testDatabaseName}:`, error.message);
      process.exitCode = 1;
    } finally {
      await admin.close();
    }
  });
