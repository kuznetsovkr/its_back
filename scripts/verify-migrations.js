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
  "carts",
  "cart_items",
  "cart_attachments",
  "cart_checkouts",
  "clothingTypes",
  "colors",
  "gift_certificates",
  "gift_certificate_deliveries",
  "gift_certificate_operations",
  "gift_certificate_reservations",
  "inventories",
  "inventory_reservations",
  "low_stock_alerts",
  "order_attachments",
  "order_items",
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
    assert.deepEqual([byCode.get("tshirt").packageLength, byCode.get("tshirt").packageWidth, byCode.get("tshirt").packageHeight], [30, 25, 3]);
    assert.deepEqual([byCode.get("hoodie").packageLength, byCode.get("hoodie").packageWidth, byCode.get("hoodie").packageHeight], [35, 35, 7]);
    assert.equal(byCode.get("tshirt").patronusLimit, 1);
    assert.equal(byCode.get("svitshot").carPrice, 5555);
    assert.equal(byCode.get("hoodie").petFacePrice, 9999);
    assert.equal(byCode.get("tshirt").carSimplePrice, 5000);
    assert.equal(byCode.get("tshirt").carMediumPrice, 7000);
    assert.equal(byCode.get("tshirt").carComplexPrice, null);
    assert.equal(byCode.get("hoodie").carComplexPrice, 11500);
    assert.equal(byCode.get("svitshot").carComplexPrice, 11000);

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

const verifyShippingMigration = async () => {
  const verification = new Sequelize(testDatabaseName, process.env.DB_USER, process.env.DB_PASSWORD, connectionOptions);
  const q = verification.getQueryInterface(); const now = new Date();
  try {
    const [[type]] = await verification.query(`SELECT id FROM "clothingTypes" WHERE code = 'hoodie'`);
    const [[inventory]] = await verification.query(`INSERT INTO inventories ("productType", color, size, quantity, "clothingTypeId", "createdAt", "updatedAt") VALUES ('Худи', 'migration fixture', 'M', 1, :type, NOW(), NOW()) RETURNING id`, { replacements: { type: type.id } });
    const [[order]] = await verification.query(`INSERT INTO orders ("inventoryId", phone, "firstName", "lastName", "productType", color, size, "embroideryType", "totalPrice", "paymentAmount", "paymentStatus", "createdAt", "updatedAt") VALUES (:inventory, '+79991234567', 'Тест', 'Тестовый', 'Худи', 'migration fixture', 'M', 'Car', 9999, 1, 'paid', NOW(), NOW()) RETURNING id`, { replacements: { inventory: inventory.id } });
    await q.bulkInsert("order_shipments", [{ orderId: order.id, provider: "cdek", status: "awaiting_fulfillment", tariffCode: 136, deliveryPoint: "FIXTURE", recipientName: "Тестовый Тест", recipientPhone: "+79991234567", declaredValue: 9500, createdAt: now, updatedAt: now }]);
    runCli(["db:migrate"]);
    const [[saved]] = await verification.query(`SELECT o."totalPrice", o."paymentAmount", s.packages FROM orders o JOIN order_shipments s ON s."orderId" = o.id WHERE o.id = :id`, { replacements: { id: order.id } });
    assert.equal(Number(saved.totalPrice), 9999); assert.equal(Number(saved.paymentAmount), 1);
    assert.deepEqual([saved.packages[0].length, saved.packages[0].width, saved.packages[0].height, saved.packages[0].weight], [7, 35, 35, 800], "legacy single shipment dimensions must not follow the new catalog");
    assert.equal(saved.packages[0].items[0].cost, 9500);
    await q.bulkUpdate("orders", { totalPrice: 10477.75 }, { id: order.id });
    const [[fractional]] = await verification.query(`SELECT "totalPrice" FROM orders WHERE id = :id`, { replacements: { id: order.id } });
    assert.equal(Number(fractional.totalPrice), 10477.75);
    await assert.rejects(require("../migrations/20261019000500-confirm-cdek-packaging-and-money").down(q, Sequelize), /Orders contain kopecks/);
    await q.bulkDelete("orders", { id: order.id }); await q.bulkDelete("inventories", { id: inventory.id });
    console.log("[shipping-migration-test] Legacy prices/parcels preserved; fractional totals retained; lossy rollback refused");
  } finally { await verification.close(); }
};

const run = async () => {
  await admin.authenticate();
  await admin.query(`CREATE DATABASE ${quoteDatabaseName(testDatabaseName)}`);
  console.log(`[migration-test] Created ${testDatabaseName}`);

  runCli(["db:migrate", "--to", "20260912000200-centralize-pricing-config.js"]);
  await seedLegacyCatalog();
  runCli(["db:migrate", "--to", "20261019000400-add-order-item-car-design.js"]);
  await verifyShippingMigration();
  assertExpectedTables(await getApplicationTables());
  await assertCatalogProfilesMigrated();

  const certificateCheck = spawnSync(process.execPath, ["scripts/verify-certificate-balances.js"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test", DB_NAME: testDatabaseName },
    encoding: "utf8", timeout: 120_000,
  });
  if (certificateCheck.stdout) process.stdout.write(certificateCheck.stdout);
  if (certificateCheck.stderr) process.stderr.write(certificateCheck.stderr);
  if (certificateCheck.error) throw certificateCheck.error;
  if (certificateCheck.status !== 0) throw new Error("Certificate integration checks failed");

  const cartCheck = spawnSync(process.execPath, ["scripts/verify-cart-storage.js"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", DB_NAME: testDatabaseName },
    encoding: "utf8", timeout: 120_000,
  });
  if (cartCheck.stdout) process.stdout.write(cartCheck.stdout);
  if (cartCheck.stderr) process.stderr.write(cartCheck.stderr);
  if (cartCheck.error) throw cartCheck.error;
  if (cartCheck.status !== 0) throw new Error("Cart integration checks failed");

  const checkoutCheck = spawnSync(process.execPath, ["scripts/verify-cart-checkout.js"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", DB_NAME: testDatabaseName }, encoding: "utf8", timeout: 120_000,
  });
  if (checkoutCheck.stdout) process.stdout.write(checkoutCheck.stdout);
  if (checkoutCheck.stderr) process.stderr.write(checkoutCheck.stderr);
  if (checkoutCheck.error) throw checkoutCheck.error;
  if (checkoutCheck.status !== 0) throw new Error("Cart checkout integration checks failed");

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
