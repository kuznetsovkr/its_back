const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  getPublicPaymentConfig,
  isPaykeeperTestMode,
  resolvePaykeeperAmount,
} = require("../services/paymentMode");

test("PayKeeper test mode charges one ruble without changing the order total", () => {
  const testEnv = { PAYKEEPER_TEST_MODE: "1" };

  assert.equal(isPaykeeperTestMode(testEnv), true);
  assert.equal(resolvePaykeeperAmount(9242, testEnv), 1);
  assert.deepEqual(getPublicPaymentConfig(testEnv), {
    provider: "paykeeper",
    testMode: true,
    testAmount: 1,
    currency: "RUB",
  });
});

test("PayKeeper production mode charges the server-calculated total", () => {
  const productionEnv = { PAYKEEPER_TEST_MODE: "0" };

  assert.equal(isPaykeeperTestMode(productionEnv), false);
  assert.equal(resolvePaykeeperAmount(9242, productionEnv), 9242);
  assert.equal(getPublicPaymentConfig(productionEnv).testAmount, null);
  assert.throws(() => resolvePaykeeperAmount(0, productionEnv), /positive number/);
});
