const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");

const requests = [];
let recipients = ["101"];

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

mockModule("axios", {
  post: async (url, data, config) => {
    requests.push({ url, data, config });
    if (url.endsWith("/sendPhoto")) {
      return { data: { result: { photo: [{ file_id: "small" }, { file_id: "photo-file" }] } } };
    }
    if (url.endsWith("/sendMediaGroup")) {
      return {
        data: {
          result: [
            { photo: [{ file_id: "album-file-1" }] },
            { photo: [{ file_id: "album-file-2" }] },
          ],
        },
      };
    }
    return { data: { ok: true } };
  },
});

mockModule("../services/telegramChannels", {
  TELEGRAM_CHANNELS: { ORDERS: "orders" },
  getTelegramChannelConfig: () => ({ enabled: true, token: "test-token" }),
  getTelegramRecipients: async () => recipients,
});
mockModule("../services/telegramProxy", {
  getTelegramAxiosRequestConfig: () => ({ proxy: false }),
});

delete require.cache[require.resolve("../telegram")];
const sendOrderToTelegram = require("../telegram");
const {
  buildOrderMessage,
  fitTelegramMessage,
  TELEGRAM_CAPTION_LIMIT,
} = sendOrderToTelegram;

const order = {
  id: 17,
  firstName: "Иван",
  lastName: "Иванов",
  middleName: "Иванович",
  phone: "79990000000",
  productType: "Худи",
  color: "Чёрный",
  size: "M",
  embroideryType: "petFace",
  petFaceCount: 1,
  deliveryCity: "Красноярск",
  deliveryAddress: "СДЭК, KRS1, ул. Мира, 1, до ПВЗ",
  totalPrice: 6000,
  paymentStatus: "paid",
  comment: "Сделать ошейник на фото чуть ярче",
};

beforeEach(() => {
  requests.length = 0;
  recipients = ["101"];
});

test("order without photos is sent as one text message with the comment", async () => {
  await sendOrderToTelegram(order);

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/sendMessage$/);
  assert.match(requests[0].data.text, /Заказ #17 — новый/);
  assert.match(requests[0].data.text, /Комментарий:\nСделать ошейник/);
  assert.equal(requests[0].data.parse_mode, undefined);
});

test("order with one photo is sent as one photo card", async () => {
  await sendOrderToTelegram(order, [{ path: __filename, originalName: "pet.jpg" }]);

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/sendPhoto$/);
  const multipartBody = requests[0].data.getBuffer().toString("utf8");
  assert.match(multipartBody, /Заказ #17 — новый/);
  assert.match(multipartBody, /Комментарий:\r?\nСделать ошейник/);
});

test("several order photos are sent as one album with a shared caption", async () => {
  await sendOrderToTelegram(order, [
    { path: __filename, originalName: "pet-1.jpg" },
    { path: __filename, originalName: "pet-2.jpg" },
  ]);

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/sendMediaGroup$/);
  const multipartBody = requests[0].data.getBuffer().toString("utf8");
  assert.match(multipartBody, /Заказ #17 — новый/);
  assert.match(multipartBody, /Комментарий:\\nСделать ошейник/);
});

test("long photo caption is safely shortened to the Telegram limit", () => {
  const message = buildOrderMessage({ ...order, comment: "Я".repeat(2500) });
  const caption = fitTelegramMessage(message, TELEGRAM_CAPTION_LIMIT);

  assert.equal(caption.length <= TELEGRAM_CAPTION_LIMIT, true);
  assert.match(caption, /Полные данные сохранены в заказе\.$/);
});
