class TelegramBotAdapter {
  constructor(bot) {
    if (!bot?.api || typeof bot.hears !== "function") {
      throw new TypeError("Telegram Bot v2 instance is required");
    }
    this.bot = bot;
  }

  onText(pattern, handler) {
    return this.bot.hears(pattern, (context) => handler(context.message));
  }

  sendMessage(chatId, text, options = {}) {
    return this.bot.api.sendMessage({
      chat_id: chatId,
      text,
      ...options,
    });
  }

  startPolling() {
    return this.bot.startPolling();
  }

  stop() {
    return this.bot.stop();
  }
}

module.exports = TelegramBotAdapter;
