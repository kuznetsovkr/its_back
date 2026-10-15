const crypto = require("node:crypto");

const CITY_TTL_MS = 30 * 24 * 60 * 60_000;
class DeliveryCityError extends Error {
  constructor(message = "Выберите город получения из списка подсказок", statusCode = 400) {
    super(message); this.statusCode = statusCode; this.code = "delivery_city_invalid"; this.field = "deliveryCityToken";
  }
}
const cityKey = () => {
  const secret = process.env.ORDER_ACCESS_SECRET || (process.env.NODE_ENV !== "production" ? process.env.JWT_SECRET : "");
  if (!secret) throw new DeliveryCityError("Выбор города временно недоступен", 503);
  return crypto.createHmac("sha256", secret).update("its:delivery-city:v1").digest();
};
const sign = (body) => crypto.createHmac("sha256", cityKey()).update(`city1.${body}`).digest("base64url");
const issueCitySelection = (city, now = Date.now()) => {
  const selection = { id: city.id, name: city.name, label: city.label, longitude: city.longitude, latitude: city.latitude,
    pickup: city.pickup === true, expiresAt: now + CITY_TTL_MS };
  const body = Buffer.from(JSON.stringify(selection)).toString("base64url");
  return { ...selection, token: `city1.${body}.${sign(body)}` };
};
const verifyCitySelection = (token, now = Date.now()) => {
  if (typeof token !== "string" || token.length > 2048) throw new DeliveryCityError();
  const [version, body, signature, extra] = token.split(".");
  if (version !== "city1" || !body || !signature || extra) throw new DeliveryCityError();
  const expected = Buffer.from(sign(body)); const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw new DeliveryCityError();
  try {
    const city = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!city.id || typeof city.name !== "string" || city.name.length > 120 || typeof city.label !== "string" || city.label.length > 255
      || !Number.isFinite(city.expiresAt) || city.expiresAt <= now || city.expiresAt > now + CITY_TTL_MS
      || !Number.isFinite(city.longitude) || !Number.isFinite(city.latitude)
      || Math.abs(city.longitude) > 180 || Math.abs(city.latitude) > 90) throw new DeliveryCityError();
    return { ...city, token };
  } catch { throw new DeliveryCityError("Срок выбора города истёк или данные изменились. Выберите город заново"); }
};
module.exports = { CITY_TTL_MS, DeliveryCityError, issueCitySelection, verifyCitySelection };
