require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const attachSubscriptionHandlers = require("./_subscribeHandlers");

const TelegramSubscriber = require("../models/TelegramSubscriber");

const token = process.env.TELEGRAM_LOW_BOT_TOKEN;
if (!token) console.warn("⚠️ TELEGRAM_LOW_BOT_TOKEN не задан");

const bot = new TelegramBot(token, { polling: true });

attachSubscriptionHandlers(bot, {
  welcomeText:
    "🎉 Подписка оформлена! Я буду присылать *уведомления о низких остатках*.\n\nКоманды:\n/stop — отписаться",
  stopText:
    "🛑 Ок, выключаю уведомления о низких остатках. (/start — включить снова)",
});

module.exports = bot;
