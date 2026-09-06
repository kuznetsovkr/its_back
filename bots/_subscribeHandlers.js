const TelegramChannelSubscriber = require("../models/TelegramChannelSubscriber");
const { isChatAllowed } = require("../services/telegramChannels");

module.exports = function attachSubscriptionHandlers(
  bot,
  {
    channel,
    channelConfig,
    subscriberModel = TelegramChannelSubscriber,
    welcomeText = "🎉 Подписка оформлена! Я буду присылать уведомления.\n\nКоманды:\n/stop — отписаться",
    stopText = "🛑 Ок, больше не буду присылать уведомления. (/start чтобы подписаться снова)",
    forbiddenText = "⛔ Этот Telegram-аккаунт не добавлен в список разрешённых получателей.",
    errorText = "Не удалось изменить подписку. Попробуйте ещё раз позднее.",
  } = {}
) {
  if (!channel || !channelConfig) {
    throw new Error("Telegram subscription channel is not configured");
  }

  const registerCommand = (pattern, handler) => {
    bot.onText(pattern, async (msg) => {
      try {
        await handler(msg);
      } catch (error) {
        const chatId = String(msg?.chat?.id || "");
        console.error(`[telegram:${channel}] Subscription command failed:`, error.message);
        if (chatId) {
          await bot.sendMessage(chatId, errorText).catch(() => {});
        }
      }
    });
  };

  // /start — подписывает
  registerCommand(/^\/start\b/i, async (msg) => {
    const chatId = String(msg.chat.id);
    if (!isChatAllowed(channelConfig, chatId)) {
      await bot.sendMessage(chatId, forbiddenText);
      return;
    }

    const { username, first_name: firstName, last_name: lastName } = msg.from || {};
    await subscriberModel.upsert({
      channel,
      chatId,
      username,
      firstName,
      lastName,
      isActive: true,
    });
    await bot.sendMessage(chatId, welcomeText, { parse_mode: "Markdown" });
  });

  // /stop — отписывает
  registerCommand(/^\/stop\b/i, async (msg) => {
    const chatId = String(msg.chat.id);
    const sub = await subscriberModel.findOne({ where: { channel, chatId } });
    if (sub) {
      sub.isActive = false;
      await sub.save();
    }
    await bot.sendMessage(chatId, stopText, { parse_mode: "Markdown" });
  });
};
