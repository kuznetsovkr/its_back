const test = require("node:test");
const assert = require("node:assert/strict");

const attachSubscriptionHandlers = require("../bots/_subscribeHandlers");
const {
  TELEGRAM_CHANNELS,
  getTelegramChannelConfig,
  getTelegramRecipients,
  parseChatIds,
  validateTelegramChannelConfig,
} = require("../services/telegramChannels");

test("Telegram chat ID разбираются строго и без дублей", () => {
  assert.deepEqual(parseChatIds("123, -456, name", "123", "", null), ["123", "-456"]);
});

test("каналы заказов и остатков имеют независимые allowlist", () => {
  const env = {
    ENABLE_TELEGRAM_ORDER_CHANNEL: "1",
    ENABLE_TELEGRAM_LOW_STOCK_CHANNEL: "1",
    TELEGRAM_BOT_TOKEN: "orders-token",
    TELEGRAM_LOW_BOT_TOKEN: "stock-token",
    TELEGRAM_ORDER_CHAT_IDS: "100",
    TELEGRAM_ORDER_ALLOWED_CHAT_IDS: "200",
    TELEGRAM_LOW_STOCK_CHAT_IDS: "300",
    TELEGRAM_LOW_STOCK_ALLOWED_CHAT_IDS: "400",
  };

  const orders = getTelegramChannelConfig(TELEGRAM_CHANNELS.ORDERS, env);
  const lowStock = getTelegramChannelConfig(TELEGRAM_CHANNELS.LOW_STOCK, env);

  assert.deepEqual(orders.allowedChatIds, ["200", "100"]);
  assert.deepEqual(lowStock.allowedChatIds, ["400", "300"]);
  assert.doesNotThrow(() => validateTelegramChannelConfig([orders, lowStock]));
});

test("рассылка исключает подписчиков вне allowlist и другого канала", async () => {
  const calls = [];
  const subscriberModel = {
    async findAll(query) {
      calls.push(query);
      return [{ chatId: "200" }, { chatId: "999" }, { chatId: "100" }];
    },
  };
  const config = {
    enabled: true,
    token: "orders-token",
    fixedChatIds: ["100"],
    allowedChatIds: ["100", "200"],
  };

  const recipients = await getTelegramRecipients(TELEGRAM_CHANNELS.ORDERS, {
    config,
    subscriberModel,
  });

  assert.deepEqual(recipients, ["100", "200"]);
  assert.deepEqual(calls[0], { where: { channel: "orders", isActive: true } });
});

test("пустой allowlist и одинаковые токены запрещают запуск каналов", () => {
  assert.throws(
    () => validateTelegramChannelConfig([{
      channel: "orders",
      enabled: true,
      token: "token",
      allowedChatIds: [],
    }]),
    /allowlist and invite token are empty/
  );

  assert.throws(
    () => validateTelegramChannelConfig([
      { channel: "orders", enabled: true, token: "same", allowedChatIds: ["1"] },
      { channel: "low_stock", enabled: true, token: "same", allowedChatIds: ["2"] },
    ]),
    /different bot tokens/
  );
});

test("a private invite token enables stored subscribers without a chat ID allowlist", async () => {
  const inviteToken = "a".repeat(32);
  const config = {
    channel: TELEGRAM_CHANNELS.ORDERS,
    enabled: true,
    token: "orders-token",
    inviteToken,
    fixedChatIds: [],
    allowedChatIds: [],
  };
  const subscriberModel = {
    async findAll() {
      return [{ chatId: "42" }, { chatId: "99" }];
    },
  };

  assert.doesNotThrow(() => validateTelegramChannelConfig([config]));
  assert.deepEqual(
    await getTelegramRecipients(TELEGRAM_CHANNELS.ORDERS, { config, subscriberModel }),
    ["42", "99"]
  );
});

test("start stores a subscriber only after a valid private invitation", async () => {
  const handlers = [];
  const messages = [];
  const upserts = [];
  const inviteToken = "b".repeat(32);
  const bot = {
    onText(pattern, handler) {
      handlers.push({ pattern, handler });
    },
    async sendMessage(chatId, text) {
      messages.push({ chatId: String(chatId), text });
    },
  };
  const subscriberModel = {
    async findOne() {
      return null;
    },
    async upsert(value) {
      upserts.push(value);
    },
  };

  attachSubscriptionHandlers(bot, {
    channel: TELEGRAM_CHANNELS.ORDERS,
    channelConfig: { allowedChatIds: [], inviteToken },
    subscriberModel,
  });

  await handlers[0].handler({ chat: { id: 42 }, text: "/start wrong", from: {} });
  await handlers[0].handler({
    chat: { id: 42 },
    text: `/start ${inviteToken}`,
    from: { username: "manager" },
  });

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].chatId, "42");
  assert.equal(messages.length, 2);
});

test("команда start сохраняет только разрешённый chat ID в нужный канал", async () => {
  const handlers = [];
  const messages = [];
  const upserts = [];
  const bot = {
    onText(pattern, handler) {
      handlers.push({ pattern, handler });
    },
    async sendMessage(chatId, text) {
      messages.push({ chatId: String(chatId), text });
    },
  };
  const subscriberModel = {
    async upsert(value) {
      upserts.push(value);
    },
    async findOne() {
      return null;
    },
  };

  attachSubscriptionHandlers(bot, {
    channel: TELEGRAM_CHANNELS.ORDERS,
    channelConfig: { allowedChatIds: ["42"] },
    subscriberModel,
  });

  await handlers[0].handler({ chat: { id: 99 }, from: { username: "outsider" } });
  await handlers[0].handler({ chat: { id: 42 }, from: { username: "manager" } });

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].channel, TELEGRAM_CHANNELS.ORDERS);
  assert.equal(upserts[0].chatId, "42");
  assert.match(messages[0].text, /не добавлен/);
});
