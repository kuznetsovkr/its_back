require("dotenv").config();
const { Bot } = require("node-telegram-bot-api");
const attachSubscriptionHandlers = require("./_subscribeHandlers");
const TelegramBotAdapter = require("./telegramBotAdapter");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
} = require("../services/telegramChannels");
const { createTelegramBotOptions } = require("../services/telegramProxy");

const channel = TELEGRAM_CHANNELS.LOW_STOCK;
const channelConfig = getTelegramChannelConfig(channel);

const bot = new TelegramBotAdapter(
  new Bot(channelConfig.token, createTelegramBotOptions())
);

attachSubscriptionHandlers(bot, {
  channel,
  channelConfig,
  welcomeText:
    "🎉 Подписка оформлена! Я буду присылать *уведомления о низких остатках*.\n\nКоманды:\n/stop — отписаться",
  stopText:
    "🛑 Ок, выключаю уведомления о низких остатках. (/start — включить снова)",
});

bot.startPolling().catch((error) => {
  console.error(`[telegram:${channel}] Polling failed:`, error.message);
});

module.exports = bot;
