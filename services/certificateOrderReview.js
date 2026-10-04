const sequelize = require("../db");
const Order = require("../models/Order");
// Keep bank confirmation durable, but never mark fulfilment as paid/complete
// when the certificate debit and inventory transaction have rolled back.
const recordCertificatePaymentReview = ({ orderId, paymentId }) => sequelize.transaction(async (transaction) => {
  const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!order || order.paymentStatus === "paid") return false;
  if (order.paymentStatus === "review") return false;
  const notify = order.paymentStatus !== "review";
  await order.update({ paymentStatus: "review", paymentProvider: "paykeeper", paykeeperPaymentId: paymentId,
    paidAt: order.paidAt || new Date(), status: "Оплата получена — требуется проверка сертификата" }, { transaction });
  console.error("[certificate-order] Paid order requires review", { orderId });
  return notify;
});
module.exports = { recordCertificatePaymentReview };
