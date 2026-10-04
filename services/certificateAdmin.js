const { Op } = require("sequelize");
const Certificate = require("../models/GiftCertificate");
const Reservation = require("../models/GiftCertificateReservation");
const Operation = require("../models/GiftCertificateOperation");
const Delivery = require("../models/GiftCertificateDelivery");
const { GiftCertificateError, getCertificateStatus, CERTIFICATE_STATUS_LABELS } = require("../lib/giftCertificateRules");

// Explicit projections: a bearer code (including its hash/ciphertext) must never
// be exposed by the admin list or history, even to an authenticated operator.
const PUBLIC_ATTRIBUTES = ["id", "buyerFullName", "buyerEmail", "nominalKopecks", "balanceKopecks", "testMode", "status", "paidAt", "expiresAt", "createdAt"];
const toAdminCertificate = (row, reservedKopecks = 0, delivery = null) => {
  const status = getCertificateStatus(row);
  return {
    id: row.id, owner: row.buyerFullName, email: row.buyerEmail,
    nominal: row.nominalKopecks / 100, balance: row.balanceKopecks / 100,
    reserved: reservedKopecks / 100, available: Math.max(0, row.balanceKopecks - reservedKopecks) / 100,
    status, statusLabel: CERTIFICATE_STATUS_LABELS[status], testMode: row.testMode,
    paidAt: row.paidAt, expiresAt: row.expiresAt, createdAt: row.createdAt,
    emailDelivery: delivery?.status || null, emailSentAt: delivery?.sentAt || null,
  };
};
const listCertificates = async ({ page, pageSize }) => {
  const { count, rows } = await Certificate.findAndCountAll({ attributes: PUBLIC_ATTRIBUTES,
    order: [["id", "DESC"]], offset: (page - 1) * pageSize, limit: pageSize });
  const items = await Promise.all(rows.map(async (row) => {
    const [reserved, delivery] = await Promise.all([
      Reservation.sum("amountKopecks", { where: { certificateId: row.id, status: "active", expiresAt: { [Op.gt]: new Date() } } }),
      Delivery.findOne({ where: { certificateId: row.id }, attributes: ["status", "sentAt"], raw: true }),
    ]);
    return toAdminCertificate(row, Number(reserved || 0), delivery);
  }));
  return { items, total: count, page, pageSize };
};
const certificateHistory = async ({ id, page, pageSize }) => {
  if (!await Certificate.findByPk(id, { attributes: ["id"] })) {
    throw new GiftCertificateError("Сертификат не найден", "certificate_not_found", 404);
  }
  const { count, rows } = await Operation.findAndCountAll({ where: { certificateId: id },
    attributes: ["id", "orderId", "type", "deltaKopecks", "balanceAfterKopecks", "createdAt"],
    order: [["id", "DESC"]], offset: (page - 1) * pageSize, limit: pageSize, raw: true });
  return { items: rows.map((row) => ({ id: row.id, orderId: row.orderId, type: row.type,
    amount: row.deltaKopecks / 100, balanceAfter: row.balanceAfterKopecks / 100, createdAt: row.createdAt })), total: count, page, pageSize };
};
module.exports = { certificateHistory, listCertificates, toAdminCertificate };
