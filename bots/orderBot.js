require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const attachSubscriptionHandlers = require("./_subscribeHandlers");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
} = require("../services/telegramChannels");

const channel = TELEGRAM_CHANNELS.ORDERS;
const channelConfig = getTelegramChannelConfig(channel);

const bot = new TelegramBot(channelConfig.token, { polling: true });

attachSubscriptionHandlers(bot, {
  channel,
  channelConfig,
  welcomeText:
    "✅ Подписка оформлена! Я буду присылать *уведомления о заказах*.\n\nКоманды:\n/stop — отписаться",
  stopText:
    "🛑 Ок, отключил уведомления о заказах. (/start — включить снова)",
});

module.exports = bot;
