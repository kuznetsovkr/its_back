const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getOrderAttachmentRetentionConfig,
  getOrderAttachmentRetentionDays,
  isOrderAttachmentExpired,
} = require("../services/orderAttachmentRetention");

test("order attachment retention has conservative configurable defaults", () => {
  const config = getOrderAttachmentRetentionConfig({});

  assert.deepEqual(config, {
    sentDays: 180,
    cancelledDays: 30,
    orphanDays: 7,
    temporaryHours: 24,
  });
  assert.equal(getOrderAttachmentRetentionDays("Отправлен", config), 180);
  assert.equal(getOrderAttachmentRetentionDays("Отменен", config), 30);
  assert.equal(getOrderAttachmentRetentionDays("Принят", config), null);
});

test("active order attachments never expire automatically", () => {
  const config = getOrderAttachmentRetentionConfig({});
  const now = new Date("2026-09-12T00:00:00.000Z");

  assert.equal(isOrderAttachmentExpired({
    status: "Вышивка",
    updatedAt: "2020-01-01T00:00:00.000Z",
  }, now, config), false);
});

test("terminal order attachments expire only after the matching period", () => {
  const config = getOrderAttachmentRetentionConfig({
    ORDER_UPLOAD_SENT_RETENTION_DAYS: "90",
    ORDER_UPLOAD_CANCELLED_RETENTION_DAYS: "14",
  });
  const now = new Date("2026-09-12T00:00:00.000Z");

  assert.equal(isOrderAttachmentExpired({
    status: "Отправлен",
    updatedAt: "2026-06-13T00:00:00.000Z",
  }, now, config), true);
  assert.equal(isOrderAttachmentExpired({
    status: "Отменен",
    updatedAt: "2026-09-01T00:00:00.000Z",
  }, now, config), false);
});

test("invalid retention settings fail closed", () => {
  assert.throws(
    () => getOrderAttachmentRetentionConfig({ ORDER_UPLOAD_SENT_RETENTION_DAYS: "0" }),
    /ORDER_UPLOAD_SENT_RETENTION_DAYS/
  );
  assert.throws(
    () => getOrderAttachmentRetentionConfig({ ORDER_UPLOAD_TEMP_RETENTION_HOURS: "forever" }),
    /ORDER_UPLOAD_TEMP_RETENTION_HOURS/
  );
});
