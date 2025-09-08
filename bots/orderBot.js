require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const attachSubscriptionHandlers = require("./_subscribeHandlers");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) console.warn("⚠️ TELEGRAM_BOT_TOKEN не задан");

const bot = new TelegramBot(token, { polling: true });

attachSubscriptionHandlers(bot, {
  welcomeText:
    "✅ Подписка оформлена! Я буду присылать *уведомления о заказах*.\n\nКоманды:\n/stop — отписаться",
  stopText:
    "🛑 Ок, отключил уведомления о заказах. (/start — включить снова)",
});

module.exports = bot;
