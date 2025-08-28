const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

const TelegramSubscriber = require("./models/TelegramSubscriber"); // ← модель подписчиков

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID || null;

if (!BOT_TOKEN) {
  console.warn("⚠️ TELEGRAM_BOT_TOKEN не задан в .env");
}

/**
 * Собираем список получателей:
 *  - ADMIN_CHAT из .env (если задан)
 *  - все активные подписчики из БД
 *  - опциональные chatId, переданные вызовом
 */
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
    // если передали file_id — можно отправлять как photo: file_id
    if (typeof fileOrId === "string" && !Buffer.isBuffer(fileOrId)) {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        chat_id: chatId,
        photo: fileOrId,
      });
      return null;
    }

    // иначе — буфер
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", fileOrId, { filename: filename || "photo.jpg" });

    const resp = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      form,
      { headers: form.getHeaders() }
    );

    // Вернём file_id — пригодится для следующих получателей
    const photos = resp?.data?.result?.photo || [];
    const best = photos[photos.length - 1];
    return best?.file_id || null;
  } catch (e) {
    console.error(`❌ sendPhoto(${chatId}) error:`, e.response?.data || e.message);
    return null;
  }
}

/**
 * Отправляет заказ в Telegram (текст + изображения) множеству получателей
 * @param {Object} order
 * @param {Object} [opts]
 * @param {string[]} [opts.extraChatIds] — доп. chatId адресатов
 * @param {boolean}  [opts.includeAdmin=true] — слать ли в админ-чат из .env
 */
const sendOrderToTelegram = async (order, opts = {}) => {
  const { extraChatIds = [], includeAdmin = true } = opts;

  // 1) текст
  const message =
    `📦 *Новый заказ!*\n\n` +
    `📅 Дата: ${new Date(order.orderDate).toLocaleString("ru-RU")}\n` +
    `📞 Телефон: ${order.phone}\n` +
    `👤 Получатель: ${order.fullName || "Не указано"}\n` +
    `🛍️ Изделие: ${order.productType || "Не указано"}, ${order.color || "Не указано"}, ${order.size || "Не указано"}\n` +
    `🎨 Вышивка: ${order.embroideryType || "Не указано"}\n` +
    `🔤 Текст: ${order.customText || "-"}\n` +
    `💬 Комментарий: ${order.comment || "Нет комментария"}\n` +
    `📍 Адрес доставки: ${order.deliveryAddress || "Не указан"}\n` +
    `💰 Стоимость заказа: ${order.totalPrice || "Не указана"}\n`;

  // 2) список получателей
  const recipients = await getRecipients(includeAdmin ? extraChatIds : extraChatIds.filter(() => true));
  if (!includeAdmin && ADMIN_CHAT) {
    // если выключили админ-чат — просто удалим его из списка (на случай, если getRecipients его добавил)
    const idx = recipients.indexOf(String(ADMIN_CHAT));
    if (idx >= 0) recipients.splice(idx, 1);
  }

  if (!recipients.length) {
    console.warn("⚠️ Нет получателей для отправки заказа");
    return;
  }

  // 3) подготовим фото в буферы один раз
  const photos = [];
  if (order.images && Array.isArray(order.images)) {
    for (const image of order.images) {
      try {
        const buffer = fs.readFileSync(image.path);
        const filename = image.originalname || image.filename || "image.jpg";
        photos.push({ buffer, filename, _path: image.path });
      } catch (e) {
        console.warn("⚠️ Не удалось прочитать файл:", image.path, e.message);
      }
    }
  }

  // 4) отправка всем получателям
  //    чтобы не упасть по rate-limit, идём последовательно
  //    оптимизация: отправили фото первому — получили file_id — и дальше шлём по file_id
  for (const chatId of recipients) {
    await sendText(chatId, message);

    // фото (если были)
    let cachedFileIds = []; // запомним file_id для текущей рассылки
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];

      // если file_id уже есть — шлём его
      if (cachedFileIds[i]) {
        await sendPhoto(chatId, cachedFileIds[i]);
        continue;
      }

      // иначе — шлём буфер и забираем file_id
      const fileId = await sendPhoto(chatId, p.buffer, p.filename);
      if (fileId) cachedFileIds[i] = fileId;
    }
  }

  // 5) удаляем временные файлы ОДИН раз, после рассылки
  for (const p of photos) {
    if (p._path) {
      fs.unlink(p._path, (err) => {
        if (err) console.warn("⚠️ Не удалось удалить временный файл:", p._path);
        else console.log("🧹 Временный файл удалён:", p._path);
      });
    }
  }
};

module.exports = sendOrderToTelegram;
