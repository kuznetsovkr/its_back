const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  getTelegramRecipients,
} = require("./services/telegramChannels");
const { getTelegramAxiosRequestConfig } = require("./services/telegramProxy");

const CHANNEL = TELEGRAM_CHANNELS.ORDERS;
const telegramRequestConfig = getTelegramAxiosRequestConfig();
const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_TEXT_LIMIT = 4096;
const TRUNCATION_NOTICE = "\n\n… Полные данные сохранены в заказе.";

async function sendText(chatId, text, { parseMode = "Markdown" } = {}) {
  const { enabled, token } = getTelegramChannelConfig(CHANNEL);
  if (!enabled || !token || !chatId) return false;
  try {
    const payload = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    if (parseMode) payload.parse_mode = parseMode;

    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      payload,
      telegramRequestConfig
    );
    return true;
  } catch (e) {
    console.error(`TG sendMessage(${chatId}) error:`, e.response?.data || e.message);
    return false;
  }
}

const bestPhotoFileId = (message) => {
  const photos = message?.photo || [];
  return photos[photos.length - 1]?.file_id || null;
};

async function sendPhotoCard(chatId, fileOrId, caption, filename) {
  const { enabled, token } = getTelegramChannelConfig(CHANNEL);
  if (!enabled || !token || !chatId) return { sent: false, fileIds: [] };
  try {
    let resp;
    if (typeof fileOrId === "string" && !Buffer.isBuffer(fileOrId)) {
      resp = await axios.post(
        `https://api.telegram.org/bot${token}/sendPhoto`,
        { chat_id: chatId, photo: fileOrId, caption },
        telegramRequestConfig
      );
    } else {
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", caption);
      form.append("photo", fileOrId, { filename: filename || "photo.jpg" });

      resp = await axios.post(
        `https://api.telegram.org/bot${token}/sendPhoto`,
        form,
        { ...telegramRequestConfig, headers: form.getHeaders() }
      );
    }

    const fileId = bestPhotoFileId(resp?.data?.result);
    return { sent: true, fileIds: fileId ? [fileId] : [] };
  } catch (e) {
    console.error(`TG sendPhoto(${chatId}) error:`, e.response?.data || e.message);
    return { sent: false, fileIds: [] };
  }
}

async function sendMediaGroupCard(chatId, mediaItems, caption) {
  const { enabled, token } = getTelegramChannelConfig(CHANNEL);
  if (!enabled || !token || !chatId) return { sent: false, fileIds: [] };

  const withCaption = (media, index) => ({
    type: "photo",
    media,
    ...(index === 0 ? { caption } : {}),
  });

  try {
    let resp;
    if (mediaItems.every((item) => typeof item === "string")) {
      resp = await axios.post(
        `https://api.telegram.org/bot${token}/sendMediaGroup`,
        {
          chat_id: chatId,
          media: mediaItems.map(withCaption),
        },
        telegramRequestConfig
      );
    } else {
      const form = new FormData();
      const media = mediaItems.map((_item, index) => withCaption(`attach://photo_${index}`, index));
      form.append("chat_id", chatId);
      form.append("media", JSON.stringify(media));
      mediaItems.forEach((item, index) => {
        form.append(`photo_${index}`, item.buffer, {
          filename: item.filename || `photo-${index + 1}.jpg`,
        });
      });

      resp = await axios.post(
        `https://api.telegram.org/bot${token}/sendMediaGroup`,
        form,
        { ...telegramRequestConfig, headers: form.getHeaders() }
      );
    }

    const messages = Array.isArray(resp?.data?.result) ? resp.data.result : [];
    return {
      sent: true,
      fileIds: messages.map(bestPhotoFileId).filter(Boolean),
    };
  } catch (e) {
    console.error(`TG sendMediaGroup(${chatId}) error:`, e.response?.data || e.message);
    return { sent: false, fileIds: [] };
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

const fitTelegramMessage = (value, limit) => {
  const text = String(value || "");
  if (text.length <= limit) return text;

  const available = Math.max(0, limit - TRUNCATION_NOTICE.length);
  let end = available;
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  return `${text.slice(0, end).trimEnd()}${TRUNCATION_NOTICE}`;
};

const buildOrderMessage = (order) => {
  const comment = String(order.comment || "").trim();
  const embroidery = embroideryLabel(order);
  const counts = [];
  if (String(order.embroideryType || "").toLowerCase() === "patronus") {
    const hasPatronus = Number.isFinite(order.patronusCount) && order.patronusCount > 0;
    if (hasPatronus) counts.push(`патронусов: ${order.patronusCount}`);
  } else if (order.embroideryType === "petFace") {
    const hasPetFace = Number.isFinite(order.petFaceCount) && order.petFaceCount > 0;
    if (hasPetFace) counts.push(`мордашек: ${order.petFaceCount}`);
  }
  const countsStr = counts.length ? ` (${counts.join(", ")})` : "";
  const customerName = fullName(order);
  const recipientName = String(order.recipientFullName || "").trim();
  const separateRecipient = recipientName && recipientName !== customerName;
  const contactDetails = [
    order.email ? `E-mail: ${order.email}` : "",
    order.preferredContact ? `Связь: ${order.preferredContact}` : "",
  ].filter(Boolean);

  return [
    `🧾 Заказ #${order.id} — новый`,
    `👤 ${customerName || "Имя не указано"}`,
    `📞 ${formatPhone(order.phone)}`,
    separateRecipient ? `📦 Получатель: ${recipientName}` : "",
    contactDetails.length ? contactDetails.join(" • ") : "",
    `🧥 ${order.productType || "-"} • ${order.color || "-"} • ${order.size || "-"}`,
    embroidery
      ? `🧵 ${embroidery}${countsStr}${order.customText ? ` «${order.customText}»` : ""}${order.customTextFont ? ` • шрифт: ${order.customTextFont}` : ""}`
      : "",
    order.deliveryCity ? `🏙 ${order.deliveryCity}` : "",
    `📍 ${order.deliveryAddress || "-"}`,
    order.deliveryComment ? `🚚 ${order.deliveryComment}` : "",
    `💰 ${priceLabel(order)}`,
    order.paidAt ? `✅ Оплачен: ${formatPaidAt(order.paidAt)}` : "",
    comment ? `💬 Комментарий:\n${comment}` : "",
  ].filter(Boolean).join("\n");
};

/**
 * Отправляет заказ одной карточкой: текстом, фото с подписью или альбомом.
 */
const sendOrderToTelegram = async (order, attachments = []) => {
  const message = buildOrderMessage(order);
  const caption = fitTelegramMessage(message, TELEGRAM_CAPTION_LIMIT);
  const textMessage = fitTelegramMessage(message, TELEGRAM_TEXT_LIMIT);

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

  let cachedFileIds = [];

  for (let idx = 0; idx < recipients.length; idx++) {
    const chatId = recipients[idx];

    if (!photos.length) {
      await sendText(chatId, textMessage, { parseMode: null });
      continue;
    }

    const reusableMedia = cachedFileIds.length === photos.length ? cachedFileIds : null;
    const media = reusableMedia || photos;
    const result = media.length === 1
      ? await sendPhotoCard(
          chatId,
          reusableMedia ? media[0] : media[0].buffer,
          caption,
          reusableMedia ? undefined : media[0].filename
        )
      : await sendMediaGroupCard(chatId, media, caption);

    if (!result.sent) {
      await sendText(chatId, textMessage, { parseMode: null });
    } else if (!reusableMedia && result.fileIds.length === photos.length) {
      cachedFileIds = result.fileIds;
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
module.exports.buildOrderMessage = buildOrderMessage;
module.exports.fitTelegramMessage = fitTelegramMessage;
module.exports.TELEGRAM_CAPTION_LIMIT = TELEGRAM_CAPTION_LIMIT;
