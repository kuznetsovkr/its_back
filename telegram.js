const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  getTelegramRecipients,
} = require("./services/telegramChannels");

const CHANNEL = TELEGRAM_CHANNELS.ORDERS;

async function sendText(chatId, text) {
  const { enabled, token } = getTelegramChannelConfig(CHANNEL);
  if (!enabled || !token || !chatId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    return true;
  } catch (e) {
    console.error(`TG sendMessage(${chatId}) error:`, e.response?.data || e.message);
    return false;
  }
}

async function sendPhoto(chatId, fileOrId, filename) {
  const { enabled, token } = getTelegramChannelConfig(CHANNEL);
  if (!enabled || !token || !chatId) return null;
  try {
    if (typeof fileOrId === "string" && !Buffer.isBuffer(fileOrId)) {
      await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
        chat_id: chatId,
        photo: fileOrId,
      });
      return null;
    }
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", fileOrId, { filename: filename || "photo.jpg" });

    const resp = await axios.post(
      `https://api.telegram.org/bot${token}/sendPhoto`,
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

const PRICE_PENDING_TEXT = "стоимость рассчитает менеджер";

const priceLabel = (order) => {
  const isManualPrice =
    order.paymentProvider === "manual" ||
    order.paymentStatus === "manual" ||
    order.totalPrice == null;
  if (isManualPrice) return PRICE_PENDING_TEXT;
  return `${order.totalPrice ?? 0} ₽`;
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
const sendOrderToTelegram = async (order, attachments = []) => {

  const comment = (order.comment || "").trim();
  const embroidery = embroideryLabel(order);
  const counts = [];
  if (String(order.embroideryType || "").toLowerCase() === "patronus") {
    const hasPatronus = Number.isFinite(order.patronusCount) && order.patronusCount > 0;
    if (hasPatronus) counts.push(`патронусов: ${order.patronusCount}`);
  } else if (order.embroideryType === "petFace") {
    const hasPetFace = Number.isFinite(order.petFaceCount) && order.petFaceCount > 0;
    if (hasPetFace) counts.push(`мордашек: ${order.petFaceCount}`);
  }
  const countsStr = counts.length ? ` (${md(counts.join(", "))})` : "";
  const priceText = priceLabel(order);
  const customerName = fullName(order);
  const recipientName = String(order.recipientFullName || "").trim();
  const separateRecipient = recipientName && recipientName !== customerName;
  const contactDetails = [
    order.email ? `E-mail: ${md(order.email)}` : "",
    order.preferredContact ? `Связь: ${md(order.preferredContact)}` : "",
  ].filter(Boolean);

  const mainMessage =
    `🧾 *Заказ #${order.id} — новый*\n` +
    `👤 ${md(customerName) || "Имя не указано"}\n` +
    `📞 ${md(formatPhone(order.phone))}\n` +
    (separateRecipient ? `📦 Получатель: ${md(recipientName)}\n` : "") +
    (contactDetails.length ? `${contactDetails.join(" • ")}\n` : "") +
    `🧥 ${md(order.productType || "-")} • ${md(order.color || "-")} • ${md(order.size || "-")}\n` +
    (embroidery
      ? `🧵 ${md(embroidery)}${countsStr}${order.customText ? ` «${md(order.customText)}»` : ""}${order.customTextFont ? ` • шрифт: ${md(order.customTextFont)}` : ""}\n`
      : ""
    ) +
    (order.deliveryCity ? `🏙 ${md(order.deliveryCity)}\n` : "") +
    `📍 ${md(order.deliveryAddress || "-")}\n` +
    (order.deliveryComment ? `🚚 ${md(order.deliveryComment)}\n` : "") +
    `💰 ${md(priceText)}\n` +
    (order.paidAt ? `✅ Оплачен: ${md(formatPaidAt(order.paidAt))}\n` : "");

  const commentMessage = comment ? `💬 Комментарий:\n${md(comment)}` : null;

  const recipients = await getTelegramRecipients(CHANNEL);
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

const sendOrderIssueToTelegram = async (order, issue) => {
  const recipients = await getTelegramRecipients(CHANNEL);
  const message =
    `🚨 *Заказ #${order.id} требует внимания*\n` +
    `${md(issue)}\n` +
    `👤 ${md(fullName(order)) || "Имя не указано"}\n` +
    `📞 ${md(formatPhone(order.phone))}`;

  let delivered = 0;
  for (const chatId of recipients) {
    if (await sendText(chatId, message)) delivered += 1;
  }
  return delivered;
};

module.exports = sendOrderToTelegram;
module.exports.sendOrderIssueToTelegram = sendOrderIssueToTelegram;
