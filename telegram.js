const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

const TelegramSubscriber = require("./models/TelegramSubscriber");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID || null;

if (!BOT_TOKEN) {
  console.warn("Пустой TELEGRAM_BOT_TOKEN в .env");
}

async function getRecipients(extraChatIds = []) {
  const set = new Set();
  if (ADMIN_CHAT) set.add(String(ADMIN_CHAT));
  try {
    const subs = await TelegramSubscriber.findAll({ where: { isActive: true } });
    subs.forEach((s) => s.chatId && set.add(String(s.chatId)));
  } catch (e) {
    console.error("Ошибка чтения подписчиков Telegram:", e.message);
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
    console.error(`TG sendMessage(${chatId}) error:`, e.response?.data || e.message);
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
    console.error(`TG sendPhoto(${chatId}) error:`, e.response?.data || e.message);
    return null;
  }
}

// Экранировать для Markdown V2
const md = (s) => String(s ?? "")
  .replace(/([_*[\]()])/g, "\\$1");

const fullName = (o) => [o.lastName, o.firstName, o.middleName].filter(Boolean).join(" ").trim();

const EMBROIDERY_LABELS = {
  petFace: "Мордочка питомца",
  patronus: "Патронус",
};

const embroideryLabel = (order) => {
  if (order.embroideryTypeRu) return order.embroideryTypeRu;
  const key = String(order.embroideryType || "").trim();
  return EMBROIDERY_LABELS[key] || key || "-";
};

const formatPhone = (phone) => {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (!digits) return "-";
  return digits.startsWith("7") ? `+${digits}` : `+7${digits}`;
};

const formatPaidAt = (ts) => {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Krasnoyarsk",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch (e) {
    return new Date(ts).toLocaleString("ru-RU");
  }
};

/**
 * Отправляет заказ в Telegram (основная инфа + комментарий + медиа)
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

  const comment = (order.comment || "").trim();
  const embroidery = embroideryLabel(order);
  const counts = [];
  const hasPatronus = Number.isFinite(order.patronusCount) && order.patronusCount > 0;
  const hasPetFace  = Number.isFinite(order.petFaceCount) && order.petFaceCount > 0;
  if (hasPatronus) counts.push(`патронусов: ${order.patronusCount}`);
  // если задан Патронус, мордашки не показываем
  if (!hasPatronus && hasPetFace) counts.push(`мордашек: ${order.petFaceCount}`);
  const countsStr = counts.length ? ` (${md(counts.join(", "))})` : "";

  const mainMessage =
    `🧾 *Заказ #${order.id} — новый*\n` +
    `👤 ${md(fullName(order)) || "Имя не указано"}\n` +
    `📞 ${md(formatPhone(order.phone))}\n` +
    `🧥 ${md(order.productType || "-")} • ${md(order.color || "-")} • ${md(order.size || "-")}\n` +
    (embroidery
      ? `🧵 ${md(embroidery)}${countsStr}${order.customText ? ` «${md(order.customText)}»` : ""}\n`
      : ""
    ) +
    `📍 ${md(order.deliveryAddress || "-")}\n` +
    `💰 ${order.totalPrice ?? 0} ₽\n` +
    (order.paidAt ? `✅ Оплачен: ${md(formatPaidAt(order.paidAt))}\n` : "");

  const commentMessage = comment ? `💬 Комментарий:\n${md(comment)}` : null;

  let recipients = await getRecipients(extraChatIds);
  if (!includeAdmin && ADMIN_CHAT) {
    recipients = recipients.filter((id) => id !== String(ADMIN_CHAT));
  }
  if (!recipients.length) {
    console.warn("Нет получателей Telegram, рассылка пропущена");
    return;
  }

  // attachments: [{ path, mime, originalName, size, ... }]
  const photos = [];
  if (attachments.length) {
    for (const att of attachments) {
      try {
        const buffer = fs.readFileSync(att.path);
        const filename = att.originalName || att.filename || "image.jpg";
        photos.push({ buffer, filename });
      } catch (e) {
        console.warn("Не удалось прочитать файл вложения:", att.path, e.message);
      }
    }
  }

  let cachedFileIds;

  for (let idx = 0; idx < recipients.length; idx++) {
    const chatId = recipients[idx];

    // 1) Основная информация
    await sendText(chatId, mainMessage);

    // 2) Комментарий (если есть)
    if (commentMessage) {
      await sendText(chatId, commentMessage);
    }

    // 3) Фото/вложения
    if (!photos.length) continue;

    if (idx === 0) {
      cachedFileIds = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const fileId = await sendPhoto(chatId, p.buffer, p.filename);
        if (fileId) cachedFileIds[i] = fileId;
      }
    } else {
      for (let i = 0; i < (cachedFileIds?.length || 0); i++) {
        const fileId = cachedFileIds[i];
        if (fileId) await sendPhoto(chatId, fileId);
      }
    }
  }
};

module.exports = sendOrderToTelegram;
