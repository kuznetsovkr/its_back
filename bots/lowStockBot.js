require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const TelegramSubscriber = require("../models/TelegramSubscriber");

const token = process.env.TELEGRAM_LOW_BOT_TOKEN;
if (!token) {
  console.warn("⚠️ TELEGRAM_LOW_BOT_TOKEN не задан");
}

const bot = new TelegramBot(token, { polling: true });

// /start — подписывает
bot.onText(/^\/start\b/i, async (msg) => {
  const chatId = String(msg.chat.id);
  const { username, first_name: firstName, last_name: lastName } = msg.from || {};

  await TelegramSubscriber.upsert({
    chatId, username, firstName, lastName, isActive: true,
  });

  bot.sendMessage(chatId,
    "🎉 Подписка оформлена! Я буду присылать уведомления о низких остатках на складе.\n\n" +
    "Команды:\n/stop — отписаться");
});

// /stop — отписывает
bot.onText(/^\/stop\b/i, async (msg) => {
  const chatId = String(msg.chat.id);
  const sub = await TelegramSubscriber.findOne({ where: { chatId } });
  if (sub) {
    sub.isActive = false;
    await sub.save();
  }
  bot.sendMessage(chatId, "🛑 Ок, больше не буду присылать уведомления. (/start чтобы подписаться снова)");
});

module.exports = bot; // на всякий случай
