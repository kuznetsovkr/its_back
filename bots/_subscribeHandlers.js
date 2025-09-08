const TelegramSubscriber = require("../models/TelegramSubscriber");

module.exports = function attachSubscriptionHandlers(
  bot,
  {
    welcomeText = "🎉 Подписка оформлена! Я буду присылать уведомления.\n\nКоманды:\n/stop — отписаться",
    stopText = "🛑 Ок, больше не буду присылать уведомления. (/start чтобы подписаться снова)",
  } = {}
) {
  // /start — подписывает
  bot.onText(/^\/start\b/i, async (msg) => {
    const chatId = String(msg.chat.id);
    const { username, first_name: firstName, last_name: lastName } = msg.from || {};
    await TelegramSubscriber.upsert({ chatId, username, firstName, lastName, isActive: true });
    bot.sendMessage(chatId, welcomeText);
  });

  // /stop — отписывает
  bot.onText(/^\/stop\b/i, async (msg) => {
    const chatId = String(msg.chat.id);
    const sub = await TelegramSubscriber.findOne({ where: { chatId } });
    if (sub) {
      sub.isActive = false;
      await sub.save();
    }
    bot.sendMessage(chatId, stopText);
  });
};
