const axios = require("axios");
const { getCdekRequestContext } = require("./cdekClient");

const DEFAULT_CDEK_TARIFF_CODE = 136;
const PRICE_FIELD_BY_EMBROIDERY = Object.freeze({
  Patronus: "patronusPrice",
  Car: "carPrice",
  petFace: "petFacePrice",
});

class PricingError extends Error {
  constructor(message, statusCode = 400, code = "invalid_price_request") {
    super(message);
    this.name = "PricingError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ");

const getClothingProfile = (inventory) => {
  const profile = inventory?.clothingType;
  if (profile?.code) return profile;
  throw new PricingError("Для выбранного изделия цена не настроена", 422, "unknown_clothing_type");
};

const normalizeEmbroideryType = (value) => {
  const normalized = normalizeText(value);
  if (normalized === "patronus") return "Patronus";
  if (normalized === "car") return "Car";
  if (normalized === "petface") return "petFace";
  if (["custom", "other", "другая", "другое"].includes(normalized)) return "custom";
  throw new PricingError("Для выбранного типа вышивки цена не настроена", 422, "unknown_embroidery_type");
};

const parseCount = (value, fieldName) => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new PricingError(`Поле ${fieldName} должно быть целым числом от 1`);
  }
  return count;
};

const calculateMerchandisePrice = ({
  inventory,
  embroideryType,
  patronusCount = 1,
  petFaceCount = 1,
  pricingConfig,
}) => {
  const normalizedType = normalizeEmbroideryType(embroideryType);
  if (normalizedType === "custom") {
    return {
      manual: true,
      merchandisePrice: null,
      clothingTypeCode: getClothingProfile(inventory).code,
      embroideryType: normalizedType,
    };
  }

  const clothingProfile = getClothingProfile(inventory);
  const basePrice = clothingProfile[PRICE_FIELD_BY_EMBROIDERY[normalizedType]];
  if (!Number.isInteger(basePrice) || basePrice <= 0) {
    throw new PricingError("Для выбранной комбинации цена не настроена", 422, "price_not_configured");
  }

  let merchandisePrice = basePrice;
  if (normalizedType === "Patronus") {
    const count = parseCount(patronusCount, "patronusCount");
    const limit = Number(clothingProfile.patronusLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
      throw new PricingError("Лимит патронусов для изделия не настроен", 500, "invalid_clothing_profile");
    }
    if (count > limit) {
      throw new PricingError(`Для выбранного изделия доступно не более ${limit} патронусов`);
    }
    const additionalPrice = pricingConfig?.additional?.Patronus;
    if (!Number.isInteger(additionalPrice) || additionalPrice < 0) {
      throw new PricingError("Доплата за дополнительного патронуса не настроена", 500, "price_not_configured");
    }
    merchandisePrice += (count - 1) * additionalPrice;
  }

  if (normalizedType === "petFace") {
    const count = parseCount(petFaceCount, "petFaceCount");
    if (count > 5) {
      throw new PricingError("Можно заказать не более 5 портретов питомца");
    }
    const additionalPrice = pricingConfig?.additional?.petFace;
    if (!Number.isInteger(additionalPrice) || additionalPrice < 0) {
      throw new PricingError("Доплата за дополнительный портрет питомца не настроена", 500, "price_not_configured");
    }
    merchandisePrice += (count - 1) * additionalPrice;
  }

  return {
    manual: false,
    merchandisePrice,
    clothingTypeCode: clothingProfile.code,
    embroideryType: normalizedType,
  };
};

const getPriceCatalog = ({ inventory, patronusCount = 1, petFaceCount = 1, pricingConfig }) => ({
  Patronus: calculateMerchandisePrice({
    inventory,
    embroideryType: "Patronus",
    patronusCount,
    petFaceCount,
    pricingConfig,
  }).merchandisePrice,
  Car: calculateMerchandisePrice({
    inventory,
    embroideryType: "Car",
    patronusCount,
    petFaceCount,
    pricingConfig,
  }).merchandisePrice,
  petFace: calculateMerchandisePrice({
    inventory,
    embroideryType: "petFace",
    patronusCount,
    petFaceCount,
    pricingConfig,
  }).merchandisePrice,
});

const getCdekTariffCode = () => {
  const code = Number(process.env.CDEK_CHECKOUT_TARIFF_CODE || DEFAULT_CDEK_TARIFF_CODE);
  if (!Number.isInteger(code) || code <= 0) {
    throw new PricingError("Некорректно настроен тариф СДЭК", 500, "invalid_cdek_tariff");
  }
  return code;
};

const getCdekFromLocation = () => {
  const cityCode = Number(process.env.CDEK_FROM_CITY_CODE || 278);
  if (!Number.isInteger(cityCode) || cityCode <= 0) {
    throw new PricingError("Некорректно настроен город отправления СДЭК", 500, "invalid_cdek_origin");
  }
  return {
    country_code: String(process.env.CDEK_FROM_COUNTRY_CODE || "RU"),
    code: cityCode,
    postal_code: String(process.env.CDEK_FROM_POSTAL_CODE || "660135"),
  };
};

const readFiniteEnv = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

const getPublicCdekConfig = () => ({
  tariffCode: getCdekTariffCode(),
  from: {
    ...getCdekFromLocation(),
    city: String(process.env.CDEK_FROM_CITY || "Красноярск"),
    address: String(process.env.CDEK_FROM_ADDRESS || ""),
  },
  defaultLocation: [
    readFiniteEnv("CDEK_FROM_LONGITUDE", 92.868),
    readFiniteEnv("CDEK_FROM_LATITUDE", 56.0106),
  ],
  defaultZoom: readFiniteEnv("CDEK_DEFAULT_ZOOM", 10),
});

const getGoodsPreset = (inventory) => {
  const profile = getClothingProfile(inventory);
  const values = {
    width: Number(profile.packageWidth),
    height: Number(profile.packageHeight),
    length: Number(profile.packageLength),
    weight: Number(profile.packageWeight),
  };
  if (Object.values(values).some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new PricingError("Габариты отправления для изделия не настроены", 500, "invalid_clothing_profile");
  }
  return {
    number: "1",
    weight: values.weight,
    length: values.length,
    width: values.width,
    height: values.height,
  };
};

const parseObject = (value) => {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const resolveOffice = async (addressRaw) => {
  const address = parseObject(addressRaw);
  const officeCode = String(address.code || address.office_code || "").trim();
  if (!officeCode) {
    throw new PricingError("Не выбран пункт выдачи СДЭК", 400, "cdek_office_required");
  }

  const { baseUrl, headers } = await getCdekRequestContext();
  const response = await axios.get(`${baseUrl}/deliverypoints`, {
    params: { code: officeCode, country_code: "RU", lang: "rus" },
    headers,
    timeout: 15_000,
  });
  const offices = Array.isArray(response.data) ? response.data : [];
  const office = offices.find((item) => String(item?.code || "") === officeCode);
  const cityCode = Number(office?.location?.city_code);
  if (!office || !Number.isInteger(cityCode) || cityCode <= 0) {
    throw new PricingError("Пункт выдачи СДЭК не найден", 422, "cdek_office_not_found");
  }

  return { office, cityCode };
};

const calculateCdekDelivery = async ({ inventory, cdekMode, cdekAddress }) => {
  if (String(cdekMode || "").toLowerCase() !== "office") {
    throw new PricingError("Для онлайн-оплаты выберите пункт выдачи СДЭК", 400, "cdek_office_required");
  }

  const { office, cityCode } = await resolveOffice(cdekAddress);
  const { baseUrl, headers } = await getCdekRequestContext();
  const tariffCode = getCdekTariffCode();
  const payload = {
    type: 1,
    currency: 1,
    lang: "rus",
    from_location: getCdekFromLocation(),
    to_location: { code: cityCode },
    packages: [getGoodsPreset(inventory)],
  };

  const response = await axios.post(`${baseUrl}/calculator/tarifflist`, payload, {
    headers,
    timeout: 15_000,
  });
  const tariffs = Array.isArray(response.data?.tariff_codes) ? response.data.tariff_codes : [];
  const tariff = tariffs.find((item) => Number(item?.tariff_code) === tariffCode);
  const rawDeliveryPrice = tariff?.delivery_sum ?? tariff?.total_sum;
  const deliveryPrice = Number(rawDeliveryPrice);

  if (!tariff || !Number.isFinite(deliveryPrice) || deliveryPrice < 0) {
    throw new PricingError(
      "СДЭК не вернул стоимость доставки для выбранного пункта",
      422,
      "cdek_tariff_unavailable"
    );
  }

  return {
    deliveryPrice: Math.round(deliveryPrice),
    tariffCode,
    tariff,
    office,
    from: getCdekFromLocation(),
    packages: [getGoodsPreset(inventory)],
  };
};

module.exports = {
  PricingError,
  calculateCdekDelivery,
  calculateMerchandisePrice,
  getCdekFromLocation,
  getCdekTariffCode,
  getGoodsPreset,
  getPublicCdekConfig,
  getPriceCatalog,
};
