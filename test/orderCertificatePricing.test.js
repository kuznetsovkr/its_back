const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildOrderPaymentSnapshot, publicOrderPayment, rublesToKopecks } = require("../services/orderCertificatePricing");

test("order certificate snapshot excludes delivery and fixes the remainder in kopecks", () => {
  const snapshot = buildOrderPaymentSnapshot({ merchandisePrice: 6000, deliveryPrice: 390.25, discountKopecks: 600000, testMode: false });
  assert.equal(snapshot.amountDueKopecks, 39025);
  assert.equal(snapshot.paymentAmount, 390.25);
  assert.deepEqual(publicOrderPayment(snapshot), { certificateDiscount: 6000, amountDue: 390.25, requiresBankPayment: true, paymentAmount: 390.25, paymentTestMode: false });
  assert.throws(() => buildOrderPaymentSnapshot({ merchandisePrice: 6000, deliveryPrice: 390, discountKopecks: 639000 }), { code: "invalid_order_certificate_discount" });
});
test("zero-due certificate order skips the bank in both live and test modes", () => {
  for (const testMode of [true, false]) {
    const free = buildOrderPaymentSnapshot({ merchandisePrice: 1000, deliveryPrice: 0, discountKopecks: 100000, testMode });
    assert.equal(free.paymentAmount, 0);
    assert.equal(publicOrderPayment(free).requiresBankPayment, false);
    const partial = buildOrderPaymentSnapshot({ merchandisePrice: 1000, deliveryPrice: 90, discountKopecks: 50000, testMode });
    assert.equal(partial.amountDueKopecks, 59000);
    assert.equal(partial.paymentAmount, testMode ? 1 : 590);
  }
});
test("certificate order amounts reject fractions, negatives and overflow", () => {
  for (const value of [-1, NaN, Infinity, 1.234, "100", 30_000_000]) assert.throws(() => rublesToKopecks(value));
  assert.equal(rublesToKopecks(1.01), 101);
  assert.equal(publicOrderPayment({ totalPrice: 6000, paymentAmount: "6000.00" }).amountDue, 6000);
});
