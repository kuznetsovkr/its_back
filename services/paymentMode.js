const PAYKEEPER_TEST_AMOUNT = 1;

const isPaykeeperTestMode = (env = process.env) =>
  String(env.PAYKEEPER_TEST_MODE || "0") === "1";

const resolvePaykeeperAmount = (orderTotal, env = process.env) => {
  const normalizedTotal = Number(orderTotal);
  if (!Number.isFinite(normalizedTotal) || normalizedTotal <= 0) {
    throw new TypeError("Order total must be a positive number");
  }

  return isPaykeeperTestMode(env) ? PAYKEEPER_TEST_AMOUNT : normalizedTotal;
};

const getPublicPaymentConfig = (env = process.env) => {
  const testMode = isPaykeeperTestMode(env);
  return {
    provider: "paykeeper",
    testMode,
    testAmount: testMode ? PAYKEEPER_TEST_AMOUNT : null,
    currency: "RUB",
  };
};

module.exports = {
  PAYKEEPER_TEST_AMOUNT,
  getPublicPaymentConfig,
  isPaykeeperTestMode,
  resolvePaykeeperAmount,
};
