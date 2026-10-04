const { assertKopecks, GiftCertificateError, planCertificatePayment } = require("../lib/giftCertificateRules");
const { isPaykeeperTestMode } = require("./paymentMode");
const rublesToKopecks = (rubles, allowZero = false) => {
  if (!Number.isFinite(rubles) || rubles < 0 || Math.abs(rubles * 100 - Math.round(rubles * 100)) > 0.000001) {
    throw new GiftCertificateError("Стоимость заказа требует проверки", "invalid_order_certificate_price", 422);
  }
  return assertKopecks(Math.round(rubles * 100), { allowZero });
};
const buildOrderPaymentSnapshot = ({ merchandisePrice, deliveryPrice, discountKopecks = 0, testMode = isPaykeeperTestMode() }) => {
  const merchandiseAmountKopecks = rublesToKopecks(merchandisePrice);
  const deliveryAmountKopecks = rublesToKopecks(deliveryPrice, true);
  assertKopecks(discountKopecks, { allowZero: true });
  if (discountKopecks > merchandiseAmountKopecks) throw new GiftCertificateError("Сертификат не покрывает доставку", "invalid_order_certificate_discount", 422);
  const { payableKopecks } = planCertificatePayment({ productKopecks: merchandiseAmountKopecks, deliveryKopecks: deliveryAmountKopecks, availableKopecks: discountKopecks });
  return {
    merchandiseAmountKopecks, deliveryAmountKopecks, certificateDiscountKopecks: discountKopecks,
    amountDueKopecks: payableKopecks, paymentTestMode: testMode,
    paymentAmount: payableKopecks === 0 ? 0 : testMode ? 1 : payableKopecks / 100,
  };
};
const publicOrderPayment = (order) => ({
  certificateDiscount: (order.certificateDiscountKopecks || 0) / 100,
  amountDue: order.amountDueKopecks == null ? order.totalPrice : order.amountDueKopecks / 100,
  requiresBankPayment: order.amountDueKopecks !== 0,
  paymentAmount: order.paymentAmount == null ? null : Number(order.paymentAmount),
  paymentTestMode: Boolean(order.paymentTestMode),
});
module.exports = { buildOrderPaymentSnapshot, publicOrderPayment, rublesToKopecks };
