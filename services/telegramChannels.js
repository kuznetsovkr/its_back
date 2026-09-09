const crypto = require("crypto");
const TelegramChannelSubscriber = require("../models/TelegramChannelSubscriber");

const TELEGRAM_CHANNELS = Object.freeze({
  ORDERS: "orders",
  LOW_STOCK: "low_stock",
});

const CHAT_ID_PATTERN = /^-?\d+$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

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
      inviteToken: String(env.TELEGRAM_ORDER_INVITE_TOKEN || "").trim(),
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
      inviteToken: String(env.TELEGRAM_LOW_STOCK_INVITE_TOKEN || "").trim(),
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

const isInviteTokenValid = (config, suppliedToken) => {
  const expected = String(config.inviteToken || "").trim();
  const supplied = String(suppliedToken || "").trim();
  if (
    !INVITE_TOKEN_PATTERN.test(expected) ||
    !INVITE_TOKEN_PATTERN.test(supplied) ||
    expected.length !== supplied.length
  ) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
};

const getTelegramRecipients = async (
  channel,
  { config = getTelegramChannelConfig(channel), subscriberModel = TelegramChannelSubscriber } = {}
) => {
  if (!config.enabled || !config.token) return [];

  const allowed = new Set(config.allowedChatIds);
  const acceptsInvitedSubscribers = Boolean(config.inviteToken);
  if (!allowed.size && !acceptsInvitedSubscribers) return [];

  const recipients = new Set(config.fixedChatIds.filter((chatId) => allowed.has(chatId)));
  const subscriptions = await subscriberModel.findAll({
    where: { channel, isActive: true },
  });

  for (const subscription of subscriptions) {
    const chatId = String(subscription.chatId || "").trim();
    if (acceptsInvitedSubscribers || allowed.has(chatId)) recipients.add(chatId);
  }

  return Array.from(recipients);
};

const validateTelegramChannelConfig = (configs) => {
  const enabledConfigs = configs.filter((config) => config.enabled);
  for (const config of enabledConfigs) {
    if (!config.token) {
      throw new Error(`Telegram token is not configured for channel ${config.channel}`);
    }
    if (!config.allowedChatIds.length && !config.inviteToken) {
      throw new Error(`Telegram allowlist and invite token are empty for channel ${config.channel}`);
    }
    if (config.inviteToken && !INVITE_TOKEN_PATTERN.test(config.inviteToken)) {
      throw new Error(`Telegram invite token is invalid for channel ${config.channel}`);
    }
  }

  if (
    enabledConfigs.length > 1 &&
    new Set(enabledConfigs.map((config) => config.token)).size !== enabledConfigs.length
  ) {
    throw new Error("Telegram channels must use different bot tokens");
  }

  const inviteTokens = enabledConfigs
    .map((config) => config.inviteToken)
    .filter(Boolean);
  if (inviteTokens.length > 1 && new Set(inviteTokens).size !== inviteTokens.length) {
    throw new Error("Telegram channels must use different invite tokens");
  }
};

module.exports = {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  getTelegramRecipients,
  isChatAllowed,
  isInviteTokenValid,
  parseChatIds,
  validateTelegramChannelConfig,
};
