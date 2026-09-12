#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const sequelize = require("../db");
const Order = require("../models/Order");
const OrderAttachment = require("../models/OrderAttachment");
const {
  ORDER_UPLOAD_DIR,
  UPLOAD_ROOT,
  isPathInside,
} = require("../lib/uploadSecurity");
const {
  CANCELLED_STATUSES,
  DAY_MS,
  SENT_STATUSES,
  getOrderAttachmentRetentionConfig,
  isOrderAttachmentExpired,
} = require("../services/orderAttachmentRetention");

const dryRun = process.argv.includes("--dry-run") || process.env.ORDER_UPLOAD_CLEANUP_DRY_RUN === "1";
const now = new Date();
const counters = {
  attachmentFiles: 0,
  attachmentRows: 0,
  orphanFiles: 0,
  temporaryFiles: 0,
  emptyDirectories: 0,
  skippedUnsafePaths: 0,
};

const removeFile = async (filePath, counterName) => {
  if (dryRun) {
    console.log(`[dry-run] remove ${filePath}`);
    counters[counterName] += 1;
    return;
  }

  try {
    await fs.promises.unlink(filePath);
    counters[counterName] += 1;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

const removeExpiredAttachment = async (attachment, order) => {
  const expectedOrderDirectory = path.join(ORDER_UPLOAD_DIR, String(order.id));
  const filePath = path.resolve(String(attachment.path || ""));
  if (!isPathInside(expectedOrderDirectory, filePath)) {
    counters.skippedUnsafePaths += 1;
    console.error(`[retention] Refusing unsafe attachment path for order ${order.id}`);
    return;
  }

  await removeFile(filePath, "attachmentFiles");
  if (dryRun) {
    counters.attachmentRows += 1;
    return;
  }

  counters.attachmentRows += await OrderAttachment.destroy({ where: { id: attachment.id } });
};

const cleanupExpiredAttachments = async (config) => {
  const sentCutoff = new Date(now.getTime() - config.sentDays * DAY_MS);
  const cancelledCutoff = new Date(now.getTime() - config.cancelledDays * DAY_MS);
  const orders = await Order.findAll({
    attributes: ["id", "status", "orderDate", "createdAt", "updatedAt"],
    where: {
      [Op.or]: [
        { status: { [Op.in]: [...SENT_STATUSES] }, updatedAt: { [Op.lte]: sentCutoff } },
        { status: { [Op.in]: [...CANCELLED_STATUSES] }, updatedAt: { [Op.lte]: cancelledCutoff } },
      ],
    },
    raw: true,
  });
  if (!orders.length) return;

  const orderById = new Map(orders.map((order) => [Number(order.id), order]));
  const attachments = await OrderAttachment.findAll({
    where: { orderId: { [Op.in]: [...orderById.keys()] } },
    raw: true,
  });

  for (const attachment of attachments) {
    const order = orderById.get(Number(attachment.orderId));
    if (order && isOrderAttachmentExpired(order, now, config)) {
      await removeExpiredAttachment(attachment, order);
    }
  }
};

const cleanupTemporaryFiles = async (config) => {
  const temporaryDirectory = path.join(UPLOAD_ROOT, ".tmp");
  let entries;
  try {
    entries = await fs.promises.readdir(temporaryDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  const cutoff = now.getTime() - config.temporaryHours * 60 * 60 * 1000;
  for (const entry of entries) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(".upload")) continue;
    const filePath = path.join(temporaryDirectory, entry.name);
    const stat = await fs.promises.lstat(filePath);
    if (stat.mtimeMs <= cutoff) await removeFile(filePath, "temporaryFiles");
  }
};

const cleanupOrphanFiles = async (config) => {
  const references = await OrderAttachment.findAll({ attributes: ["path"], raw: true });
  const referencedPaths = new Set(references.map(({ path: value }) => path.resolve(String(value))));
  let orderDirectories;
  try {
    orderDirectories = await fs.promises.readdir(ORDER_UPLOAD_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  const cutoff = now.getTime() - config.orphanDays * DAY_MS;
  for (const directory of orderDirectories) {
    if (!directory.isDirectory() || !/^\d+$/.test(directory.name)) continue;
    const orderDirectory = path.join(ORDER_UPLOAD_DIR, directory.name);
    const entries = await fs.promises.readdir(orderDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(orderDirectory, entry.name);
      if (referencedPaths.has(path.resolve(filePath))) continue;
      const stat = await fs.promises.lstat(filePath);
      if (stat.mtimeMs <= cutoff) await removeFile(filePath, "orphanFiles");
    }

    if (!dryRun && (await fs.promises.readdir(orderDirectory)).length === 0) {
      await fs.promises.rmdir(orderDirectory);
      counters.emptyDirectories += 1;
    }
  }
};

const main = async () => {
  const config = getOrderAttachmentRetentionConfig();
  if (path.resolve(UPLOAD_ROOT) === path.parse(path.resolve(UPLOAD_ROOT)).root) {
    throw new Error("Refusing to clean a filesystem root");
  }
  if (!isPathInside(UPLOAD_ROOT, ORDER_UPLOAD_DIR)) {
    throw new Error("Order upload directory is outside UPLOAD_DIR");
  }

  await sequelize.authenticate();
  await cleanupExpiredAttachments(config);
  await cleanupTemporaryFiles(config);
  await cleanupOrphanFiles(config);

  console.log(JSON.stringify({
    dryRun,
    retention: config,
    removed: counters,
  }));

  if (counters.skippedUnsafePaths > 0) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(`[retention] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
