const { Op } = require("sequelize");
const sequelize = require("../db");
const GiftCertificate = require("../models/GiftCertificate");
const Delivery = require("../models/GiftCertificateDelivery");
const { getCertificateCodeForDelivery } = require("./giftCertificates");
const { sendCertificateEmail } = require("./certificateMail");
const MAX_ATTEMPTS = 12;
const retryDelayMs = (attempt) => Math.min(60_000 * 2 ** Math.min(attempt - 1, 10), 6 * 60 * 60_000);
const safeMailErrorCode = (error) => /^[A-Z0-9_]{1,40}$/.test(error?.code || "") ? error.code : "MAIL_SEND_FAILED";
const queueCertificateDelivery = (certificateId, transaction) => Delivery.findOrCreate({
  where: { certificateId }, defaults: { nextAttemptAt: new Date() }, transaction,
});
const claimDelivery = () => sequelize.transaction(async (transaction) => {
  const now = new Date();
  const job = await Delivery.findOne({
    where: {
      [Op.or]: [
        { status: "pending", nextAttemptAt: { [Op.lte]: now } },
        { status: "sending", lockedUntil: { [Op.lte]: now } },
      ],
    },
    order: [["nextAttemptAt", "ASC"], ["id", "ASC"]],
    transaction, lock: transaction.LOCK.UPDATE, skipLocked: true,
  });
  if (!job) return null;
  if (job.attempts >= MAX_ATTEMPTS) {
    await job.update({ status: "failed", lockedUntil: null, lastErrorCode: "DELIVERY_ATTEMPTS_EXHAUSTED" }, { transaction });
    console.error("[certificate-mail] Delivery attempts exhausted", { certificateId: job.certificateId });
    return null;
  }
  await job.update({ status: "sending", attempts: job.attempts + 1, lockedUntil: new Date(Date.now() + 180_000) }, { transaction });
  return job;
});
const processCertificateDeliveries = async ({ send = sendCertificateEmail, maxJobs = 20 } = {}) => {
  let processed = 0;
  for (let index = 0; index < Math.min(maxJobs, 100); index += 1) {
    const job = await claimDelivery();
    if (!job) break;
    try {
      const certificate = await GiftCertificate.findByPk(job.certificateId);
      if (!certificate) throw new Error("Certificate missing");
      await send(certificate, getCertificateCodeForDelivery(certificate));
      await Delivery.update({ status: "sent", sentAt: new Date(), lockedUntil: null, lastErrorCode: null }, {
        where: { id: job.id, status: "sending", attempts: job.attempts },
      });
    } catch (error) {
      const code = safeMailErrorCode(error);
      await Delivery.update({
        status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        lockedUntil: null, lastErrorCode: code,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(job.attempts)),
      }, { where: { id: job.id, status: "sending", attempts: job.attempts } });
      // SMTP error messages may contain recipients, credentials or message data.
      console.error("[certificate-mail] Delivery failed", { certificateId: job.certificateId, attempt: job.attempts, code });
    }
    processed += 1;
  }
  return processed;
};
module.exports = { processCertificateDeliveries, queueCertificateDelivery, retryDelayMs, safeMailErrorCode };
