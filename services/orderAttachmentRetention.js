const DAY_MS = 24 * 60 * 60 * 1000;

const SENT_STATUSES = new Set(["Отправлен"]);
const CANCELLED_STATUSES = new Set([
  "Отменен",
  "Резерв истёк",
  "Ошибка сохранения вложений",
]);

const parseRetentionValue = (value, fallback, name) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw new Error(`${name} must be an integer between 1 and 3650`);
  }
  return parsed;
};

const getOrderAttachmentRetentionConfig = (env = process.env) => ({
  sentDays: parseRetentionValue(
    env.ORDER_UPLOAD_SENT_RETENTION_DAYS,
    180,
    "ORDER_UPLOAD_SENT_RETENTION_DAYS"
  ),
  cancelledDays: parseRetentionValue(
    env.ORDER_UPLOAD_CANCELLED_RETENTION_DAYS,
    30,
    "ORDER_UPLOAD_CANCELLED_RETENTION_DAYS"
  ),
  orphanDays: parseRetentionValue(
    env.ORDER_UPLOAD_ORPHAN_RETENTION_DAYS,
    7,
    "ORDER_UPLOAD_ORPHAN_RETENTION_DAYS"
  ),
  temporaryHours: parseRetentionValue(
    env.ORDER_UPLOAD_TEMP_RETENTION_HOURS,
    24,
    "ORDER_UPLOAD_TEMP_RETENTION_HOURS"
  ),
});

const getOrderAttachmentRetentionDays = (status, config) => {
  if (SENT_STATUSES.has(status)) return config.sentDays;
  if (CANCELLED_STATUSES.has(status)) return config.cancelledDays;
  return null;
};

const isOrderAttachmentExpired = (order, now, config) => {
  const retentionDays = getOrderAttachmentRetentionDays(order?.status, config);
  if (!retentionDays) return false;

  const statusUpdatedAt = new Date(order.updatedAt || order.orderDate || order.createdAt);
  if (Number.isNaN(statusUpdatedAt.getTime())) return false;
  return now.getTime() - statusUpdatedAt.getTime() >= retentionDays * DAY_MS;
};

module.exports = {
  CANCELLED_STATUSES,
  DAY_MS,
  SENT_STATUSES,
  getOrderAttachmentRetentionConfig,
  getOrderAttachmentRetentionDays,
  isOrderAttachmentExpired,
};
