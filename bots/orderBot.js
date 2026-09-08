require("dotenv").config();
const { Bot } = require("node-telegram-bot-api");
const attachSubscriptionHandlers = require("./_subscribeHandlers");
const TelegramBotAdapter = require("./telegramBotAdapter");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
} = require("../services/telegramChannels");

const channel = TELEGRAM_CHANNELS.ORDERS;
const channelConfig = getTelegramChannelConfig(channel);

const bot = new TelegramBotAdapter(new Bot(channelConfig.token));

attachSubscriptionHandlers(bot, {
  channel,
  channelConfig,
  welcomeText:
    "✅ Подписка оформлена! Я буду присылать *уведомления о заказах*.\n\nКоманды:\n/stop — отписаться",
  stopText:
    "🛑 Ок, отключил уведомления о заказах. (/start — включить снова)",
});

bot.startPolling().catch((error) => {
  console.error(`[telegram:${channel}] Polling failed:`, error.message);
});

module.exports = bot;
