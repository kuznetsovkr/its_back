const axios = require("axios");
const TelegramSubscriber = require("../models/TelegramSubscriber");

const BOT_TOKEN = process.env.TELEGRAM_LOW_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_LOW_CHAT_ID || null;

async function sendTo(chatId, text) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true,
    });
  } catch (e) {
    console.error("Telegram send error:", chatId, e.response?.data || e.message);
  }
}

async function broadcast(text) {
  const recipients = new Set();
  if (ADMIN_CHAT) recipients.add(String(ADMIN_CHAT));

  const subs = await TelegramSubscriber.findAll({ where: { isActive: true } });
  subs.forEach(s => recipients.add(String(s.chatId)));

  for (const chatId of recipients) {
    await sendTo(chatId, text);
  }
}

async function sendLowStockAlert(items, threshold = 10) {
  if (!items?.length) return;
  const header = `⚠️ *Низкий остаток на складе* (меньше ${threshold})\n`;
  const lines = items.map(
    (i) => `• *${i.productType}* — ${i.color}, ${i.size} → осталось: *${i.quantity}*`
  );

  // простое разбиение по длине
  let chunk = header;
  for (const line of lines) {
    if ((chunk + line + "\n").length > 3800) {
      await broadcast(chunk);
      chunk = header + line + "\n";
    } else {
      chunk += line + "\n";
    }
  }
  if (chunk.trim().length > header.length) {
    await broadcast(chunk);
  }
}

module.exports = { sendLowStockAlert };
