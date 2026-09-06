const axios = require("axios");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  getTelegramRecipients,
} = require("./telegramChannels");

const CHANNEL = TELEGRAM_CHANNELS.LOW_STOCK;

async function sendTo(chatId, text) {
  const { enabled, token } = getTelegramChannelConfig(CHANNEL);
  if (!enabled || !token || !chatId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true,
    });
    return true;
  } catch (e) {
    console.error("Telegram send error:", chatId, e.response?.data || e.message);
    return false;
  }
}

async function broadcast(text) {
  const recipients = await getTelegramRecipients(CHANNEL);
  let delivered = 0;

  for (const chatId of recipients) {
    if (await sendTo(chatId, text)) delivered += 1;
  }
  return delivered;
}

async function sendLowStockAlert(items, threshold = 10) {
  if (!items?.length) return 0;
  const header = `⚠️ *Низкий остаток на складе* (меньше ${threshold})\n`;
  const lines = items.map(
    (i) => `• *${i.productType}* — ${i.color}, ${i.size} → осталось: *${i.quantity}*`
  );

  // простое разбиение по длине
  let chunk = header;
  let delivered = 0;
  for (const line of lines) {
    if ((chunk + line + "\n").length > 3800) {
      delivered += await broadcast(chunk);
      chunk = header + line + "\n";
    } else {
      chunk += line + "\n";
    }
  }
  if (chunk.trim().length > header.length) {
    delivered += await broadcast(chunk);
  }
  return delivered;
}

module.exports = { sendLowStockAlert };
