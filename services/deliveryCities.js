const axios = require("axios");
const { DeliveryCityError, issueCitySelection } = require("../lib/deliveryCity");

const DADATA_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs";
const KRASNOYARSK_CDEK_CODE = 278;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const clean = (value, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : "";
const normalizeCitySuggestion = (suggestion, coordinatesRequired = false) => {
  const data = suggestion?.data || {};
  const isSettlement = String(data.fias_level) === "6";
  // Federal cities (e.g. Moscow) have region level 1 in FIAS, not city level 4.
  const isFederalCity = String(data.fias_level) === "1" && data.city
    && data.city_fias_id === data.region_fias_id && data.region_type === "г";
  const id = isSettlement ? data.settlement_fias_id : data.city_fias_id;
  if (data.country_iso_code !== "RU" || (!isFederalCity && !["4", "6"].includes(String(data.fias_level)))
    || !uuid.test(id || "") || data.street || data.house) return null;
  const name = clean(isSettlement ? data.settlement : data.city);
  const label = clean(suggestion.value, 255);
  const longitude = data.geo_lon == null || data.geo_lon === "" ? NaN : Number(data.geo_lon);
  const latitude = data.geo_lat == null || data.geo_lat === "" ? NaN : Number(data.geo_lat);
  if (!name || !label || (coordinatesRequired && (!Number.isFinite(longitude) || !Number.isFinite(latitude)
    || Math.abs(longitude) > 180 || Math.abs(latitude) > 90))) return null;
  return { id: id.toLowerCase(), name, label, longitude, latitude,
    pickup: !isSettlement && data.city === "Красноярск" && data.region_iso_code === "RU-KYA" };
};
const createCityService = ({ post = (...args) => axios.post(...args), getOffice = (code) => require("./orderPricing").resolveOffice({ code }), now = Date.now } = {}) => {
  const cache = new Map(); const pending = new Map();
  const cached = async (key, ttl, load) => {
    const hit = cache.get(key); if (hit && hit.until > now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 100) throw new DeliveryCityError("Сервис городов занят. Попробуйте ещё раз", 503);
    const promise = Promise.resolve().then(load).then(value => {
      cache.delete(key); cache.set(key, { value, until: now() + ttl });
      if (cache.size > 1000) cache.delete(cache.keys().next().value);
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  };
  const dadata = async (method, payload) => {
    const token = String(process.env.DADATA_API_KEY || process.env.DADATA_TOKEN || "").trim();
    if (!token) throw new DeliveryCityError("Подсказки городов пока не настроены. Попробуйте позднее", 503);
    try {
      const response = await post(`${DADATA_URL}/${method}/address`, payload, {
        headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" }, timeout: 7000,
      });
      return Array.isArray(response.data?.suggestions) ? response.data.suggestions : [];
    } catch { throw new DeliveryCityError("Не удалось загрузить города. Повторите попытку", 503); }
  };
  return {
    async suggest(query) {
      const suggestions = await cached(`query:${query.toLocaleLowerCase("ru")}`, 5 * 60_000, () => dadata("suggest", {
        query, count: 7, from_bound: { value: "city" }, to_bound: { value: "settlement" }, locations: [{ country_iso_code: "RU" }],
      }));
      return suggestions.map(value => normalizeCitySuggestion(value)).filter(Boolean).map(({ id, name, label }) => ({ id, name, label }));
    },
    async resolve(id) {
      if (!uuid.test(id)) throw new DeliveryCityError();
      const city = await cached(`city:${id}`, 24 * 60 * 60_000, async () => {
        const suggestions = await dadata("findById", { query: id, count: 1 });
        const result = suggestions.map(value => normalizeCitySuggestion(value, true)).find(value => value?.id === id.toLowerCase());
        if (!result) throw new DeliveryCityError("Не удалось определить населённый пункт. Выберите другую подсказку");
        return result;
      });
      return issueCitySelection(city);
    },
    async office(code) {
      const city = await cached(`office:${code}`, 5 * 60_000, async () => {
        const { office, cityCode } = await getOffice(code);
        const location = office?.location || {};
        const name = clean(location.city);
        const longitude = Number(location.longitude); const latitude = Number(location.latitude);
        if (!name || location.longitude == null || location.latitude == null || location.longitude === "" || location.latitude === ""
          || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
          throw new DeliveryCityError("Не удалось определить город выбранного ПВЗ. Выберите другой пункт", 422);
        }
        return { id: `cdek:${cityCode}`, name, label: [location.region, name].filter(Boolean).join(", "), longitude, latitude,
          pickup: cityCode === KRASNOYARSK_CDEK_CODE && name === "Красноярск" && (!location.country_code || location.country_code === "RU") };
      });
      return issueCitySelection(city);
    },
  };
};
module.exports = { createCityService, normalizeCitySuggestion };
