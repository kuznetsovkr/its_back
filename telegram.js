const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

const TelegramSubscriber = require("./models/TelegramSubscriber");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID || null;

if (!BOT_TOKEN) {
  console.warn("⚠️ TELEGRAM_BOT_TOKEN не задан в .env");
}

async function getRecipients(extraChatIds = []) {
  const set = new Set();
  if (ADMIN_CHAT) set.add(String(ADMIN_CHAT));
  try {
    const subs = await TelegramSubscriber.findAll({ where: { isActive: true } });
    subs.forEach((s) => s.chatId && set.add(String(s.chatId)));
  } catch (e) {
    console.error("⚠️ Не удалось прочитать подписчиков:", e.message);
  }
  (extraChatIds || []).forEach((id) => id && set.add(String(id)));
  return Array.from(set);
}

async function sendText(chatId, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error(`❌ sendMessage(${chatId}) error:`, e.response?.data || e.message);
  }
}

async function sendPhoto(chatId, fileOrId, filename) {
  try {
    if (typeof fileOrId === "string" && !Buffer.isBuffer(fileOrId)) {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        chat_id: chatId,
        photo: fileOrId,
      });
      return null;
    }
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", fileOrId, { filename: filename || "photo.jpg" });

    const resp = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      form,
      { headers: form.getHeaders() }
    );

    const photos = resp?.data?.result?.photo || [];
    const best = photos[photos.length - 1];
    return best?.file_id || null;
  } catch (e) {
    console.error(`❌ sendPhoto(${chatId}) error:`, e.response?.data || e.message);
    return null;
  }
}

// Утилита для форматирования ФИО
function fullName(o) {
  return [o.lastName, o.firstName, o.middleName].filter(Boolean).join(" ").trim();
}

/**
 * Отправляет заказ в Telegram (текст + изображения)
 * Поддерживает два варианта вызова:
 *  - sendOrderToTelegram(order, attachmentsArray)
 *  - sendOrderToTelegram(order, { extraChatIds, includeAdmin })
 */
const sendOrderToTelegram = async (order, attachmentsOrOpts = [], maybeOpts = {}) => {
  let attachments = [];
  let opts = {};

  if (Array.isArray(attachmentsOrOpts)) {
    attachments = attachmentsOrOpts;
    opts = maybeOpts || {};
  } else if (attachmentsOrOpts && typeof attachmentsOrOpts === "object") {
    opts = attachmentsOrOpts;
  }

  const { extraChatIds = [], includeAdmin = true } = opts;

  const message =
    `🧾 *Заказ #${order.id} — ОПЛАЧЕНО*\n` +
    `👤 ${fullName(order) || "Не указано"}\n` +
    `📞 ${order.phone || "-"}\n` +
    `👕 ${order.productType || "-"} • ${order.color || "-"} • ${order.size || "-"}\n` +
    (order.embroideryType ? `🧵 ${order.embroideryType}${order.customText ? ` — «${order.customText}»` : ""}\n` : "") +
    `📦 ${order.deliveryAddress || "-"}\n` +
    `💰 ${order.totalPrice ?? 0} ₽\n` +
    (order.paidAt ? `⏱ ${new Date(order.paidAt).toLocaleString("ru-RU")}\n` : "");

  // Список получателей
  let recipients = await getRecipients(extraChatIds);
  if (!includeAdmin && ADMIN_CHAT) {
    recipients = recipients.filter((id) => id !== String(ADMIN_CHAT));
  }
  if (!recipients.length) {
    console.warn("⚠️ Нет получателей для отправки заказа");
    return;
  }

  // Подготовим фото:
  // attachments: [{ path, mime, originalName, size, ... }]
  const photos = [];
  if (attachments.length) {
    for (const att of attachments) {
      try {
        const buffer = fs.readFileSync(att.path);
        const filename = att.originalName || att.filename || "image.jpg";
        photos.push({ buffer, filename });
      } catch (e) {
        console.warn("⚠️ Не удалось прочитать файл:", att.path, e.message);
      }
    }
  }

  // Рассылка: текст + фото (по одному), без удаления файлов (они постоянные)
  for (const chatId of recipients) {
    await sendText(chatId, message);

    let cachedFileIds = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (cachedFileIds[i]) {
        await sendPhoto(chatId, cachedFileIds[i]);
        continue;
      }
      const fileId = await sendPhoto(chatId, p.buffer, p.filename);
      if (fileId) cachedFileIds[i] = fileId;
    }
  }
};

module.exports = sendOrderToTelegram;
