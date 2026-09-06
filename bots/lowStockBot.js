require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const attachSubscriptionHandlers = require("./_subscribeHandlers");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
} = require("../services/telegramChannels");

const channel = TELEGRAM_CHANNELS.LOW_STOCK;
const channelConfig = getTelegramChannelConfig(channel);

const bot = new TelegramBot(channelConfig.token, { polling: true });

attachSubscriptionHandlers(bot, {
  channel,
  channelConfig,
  welcomeText:
    "🎉 Подписка оформлена! Я буду присылать *уведомления о низких остатках*.\n\nКоманды:\n/stop — отписаться",
  stopText:
    "🛑 Ок, выключаю уведомления о низких остатках. (/start — включить снова)",
});

module.exports = bot;
