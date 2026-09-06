const TelegramChannelSubscriber = require("../models/TelegramChannelSubscriber");

const TELEGRAM_CHANNELS = Object.freeze({
  ORDERS: "orders",
  LOW_STOCK: "low_stock",
});

const CHAT_ID_PATTERN = /^-?\d+$/;

const parseChatIds = (...values) => {
  const ids = new Set();
  for (const value of values) {
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => CHAT_ID_PATTERN.test(item))
      .forEach((item) => ids.add(item));
  }
  return Array.from(ids);
};

const getTelegramChannelConfig = (channel, env = process.env) => {
  if (channel === TELEGRAM_CHANNELS.ORDERS) {
    const fixedChatIds = parseChatIds(env.TELEGRAM_ORDER_CHAT_IDS, env.TELEGRAM_CHAT_ID);
    return {
      channel,
      enabled: env.ENABLE_TELEGRAM_ORDER_CHANNEL === "1",
      token: String(env.TELEGRAM_BOT_TOKEN || "").trim(),
      fixedChatIds,
      allowedChatIds: parseChatIds(env.TELEGRAM_ORDER_ALLOWED_CHAT_IDS, fixedChatIds.join(",")),
    };
  }

  if (channel === TELEGRAM_CHANNELS.LOW_STOCK) {
    const fixedChatIds = parseChatIds(env.TELEGRAM_LOW_STOCK_CHAT_IDS, env.TELEGRAM_LOW_CHAT_ID);
    return {
      channel,
      enabled: env.ENABLE_TELEGRAM_LOW_STOCK_CHANNEL === "1",
      token: String(env.TELEGRAM_LOW_BOT_TOKEN || "").trim(),
      fixedChatIds,
      allowedChatIds: parseChatIds(
        env.TELEGRAM_LOW_STOCK_ALLOWED_CHAT_IDS,
        fixedChatIds.join(",")
      ),
    };
  }

  throw new Error(`Unknown Telegram channel: ${channel}`);
};

const isChatAllowed = (config, chatId) =>
  config.allowedChatIds.includes(String(chatId || "").trim());

const getTelegramRecipients = async (
  channel,
  { config = getTelegramChannelConfig(channel), subscriberModel = TelegramChannelSubscriber } = {}
) => {
  if (!config.enabled || !config.token) return [];

  const allowed = new Set(config.allowedChatIds);
  if (!allowed.size) return [];

  const recipients = new Set(config.fixedChatIds.filter((chatId) => allowed.has(chatId)));
  const subscriptions = await subscriberModel.findAll({
    where: { channel, isActive: true },
  });

  for (const subscription of subscriptions) {
    const chatId = String(subscription.chatId || "").trim();
    if (allowed.has(chatId)) recipients.add(chatId);
  }

  return Array.from(recipients);
};

const validateTelegramChannelConfig = (configs) => {
  const enabledConfigs = configs.filter((config) => config.enabled);
  for (const config of enabledConfigs) {
    if (!config.token) {
      throw new Error(`Telegram token is not configured for channel ${config.channel}`);
    }
    if (!config.allowedChatIds.length) {
      throw new Error(`Telegram allowlist is empty for channel ${config.channel}`);
    }
  }

  if (
    enabledConfigs.length > 1 &&
    new Set(enabledConfigs.map((config) => config.token)).size !== enabledConfigs.length
  ) {
    throw new Error("Telegram channels must use different bot tokens");
  }
};

module.exports = {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  getTelegramRecipients,
  isChatAllowed,
  parseChatIds,
  validateTelegramChannelConfig,
};
