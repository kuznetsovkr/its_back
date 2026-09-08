const test = require("node:test");
const assert = require("node:assert/strict");
const TelegramBotAdapter = require("../bots/telegramBotAdapter");

test("Telegram v2 adapter preserves subscription handler contract", async () => {
  const calls = [];
  let textHandler;
  const coreBot = {
    api: {
      sendMessage: async (payload) => {
        calls.push(payload);
        return { ok: true };
      },
    },
    hears(pattern, handler) {
      calls.push(pattern);
      textHandler = handler;
      return this;
    },
    async startPolling() {
      calls.push("start");
    },
    async stop() {
      calls.push("stop");
    },
  };
  const adapter = new TelegramBotAdapter(coreBot);
  let receivedMessage;

  adapter.onText(/^\/start\b/i, async (message) => {
    receivedMessage = message;
  });
  await textHandler({ message: { chat: { id: 42 }, text: "/start" } });
  await adapter.sendMessage("42", "Готово", { parse_mode: "Markdown" });
  await adapter.startPolling();
  await adapter.stop();

  assert.equal(receivedMessage.chat.id, 42);
  assert.deepEqual(calls[1], {
    chat_id: "42",
    text: "Готово",
    parse_mode: "Markdown",
  });
  assert.deepEqual(calls.slice(2), ["start", "stop"]);
});
