const {
  RequestValidationError,
  assertAllowedKeys,
  ensurePlainObject,
  readPositiveInteger,
  readString,
} = require("./requestValidation");
const { getCdekFromLocation } = require("../services/orderPricing");

const OFFICE_FIELDS = new Set([
  "action", "page", "size", "type", "country_code", "lang", "city_code",
  "postal_code", "region_code", "have_cashless", "have_cash", "allowed_cod",
  "is_dressing_room", "is_handout", "is_handout_only", "is_reception",
]);
const OFFICE_POLYGON_FIELDS = new Set([
  "action",
  "latitude_right_top",
  "longitude_right_top",
  "latitude_left_bottom",
  "longitude_left_bottom",
  "type",
  "have_cashless",
  "have_cash",
  "allowed_cod",
  "is_dressing_room",
  "is_handout",
  "is_handout_only",
  "is_reception",
]);
const CALCULATE_FIELDS = new Set([
  "action", "currency", "lang", "from_location", "to_location", "packages",
]);

const parseOptionalInteger = (value, field, { min = 0, max = 1_000_000 } = {}) => {
  if (value == null || value === "") return undefined;
  return readPositiveInteger(value, field, { min, max });
};

const parseOptionalBoolean = (value, field) => {
  if (value == null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new RequestValidationError(`Поле ${field} должно быть логическим значением`, field);
};

const parseCoordinate = (value, field, { min, max }) => {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new RequestValidationError(`Поле ${field} должно быть координатой`, field);
  }

  const normalized = String(value).trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
    throw new RequestValidationError(`Поле ${field} должно быть координатой`, field);
  }

  const coordinate = Number(normalized);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw new RequestValidationError(
      `Поле ${field} должно быть числом от ${min} до ${max}`,
      field
    );
  }
  return coordinate;
};

const parseOptionalOfficeType = (value) => {
  if (value == null || value === "") return undefined;
  const type = readString(value, "type", { max: 16 }).toUpperCase();
  if (!["PVZ", "POSTAMAT", "ALL"].includes(type)) {
    throw new RequestValidationError("Некорректный тип пункта выдачи", "type");
  }
  return type;
};

const removeUndefined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

const buildCdekOfficesParams = (data) => {
  ensurePlainObject(data, "query");
  assertAllowedKeys(data, OFFICE_FIELDS, "запросе СДЭК");

  const type = readString(data.type, "type", { max: 16 }).toUpperCase() || "PVZ";
  if (!["PVZ", "POSTAMAT", "ALL"].includes(type)) {
    throw new RequestValidationError("Некорректный тип пункта выдачи", "type");
  }
  const countryCode = readString(data.country_code, "country_code", { max: 2 }).toUpperCase() || "RU";
  if (countryCode !== "RU") {
    throw new RequestValidationError("Поддерживаются только пункты выдачи в России", "country_code");
  }
  const lang = readString(data.lang, "lang", { max: 3 }).toLowerCase() || "rus";
  if (lang !== "rus") throw new RequestValidationError("Поддерживается только русский язык", "lang");

  return removeUndefined({
    type,
    country_code: countryCode,
    lang,
    size: parseOptionalInteger(data.size, "size", { min: 1, max: 500 }) || 500,
    page: parseOptionalInteger(data.page, "page", { min: 0, max: 1000 }) || 0,
    city_code: parseOptionalInteger(data.city_code, "city_code", { min: 1 }),
    region_code: parseOptionalInteger(data.region_code, "region_code", { min: 1 }),
    postal_code: data.postal_code
      ? readString(String(data.postal_code), "postal_code", { max: 12 })
      : undefined,
    have_cashless: parseOptionalBoolean(data.have_cashless, "have_cashless"),
    have_cash: parseOptionalBoolean(data.have_cash, "have_cash"),
    allowed_cod: parseOptionalBoolean(data.allowed_cod, "allowed_cod"),
    is_dressing_room: parseOptionalBoolean(data.is_dressing_room, "is_dressing_room"),
    is_handout: parseOptionalBoolean(data.is_handout, "is_handout"),
    is_handout_only: parseOptionalBoolean(data.is_handout_only, "is_handout_only"),
    is_reception: parseOptionalBoolean(data.is_reception, "is_reception"),
  });
};

const buildCdekOfficesByCoordinateParams = (data) => {
  ensurePlainObject(data, "query");
  assertAllowedKeys(data, OFFICE_POLYGON_FIELDS, "запросе СДЭК по области карты");

  const latitudeRightTop = parseCoordinate(
    data.latitude_right_top,
    "latitude_right_top",
    { min: -90, max: 90 }
  );
  const longitudeRightTop = parseCoordinate(
    data.longitude_right_top,
    "longitude_right_top",
    { min: -180, max: 180 }
  );
  const latitudeLeftBottom = parseCoordinate(
    data.latitude_left_bottom,
    "latitude_left_bottom",
    { min: -90, max: 90 }
  );
  const longitudeLeftBottom = parseCoordinate(
    data.longitude_left_bottom,
    "longitude_left_bottom",
    { min: -180, max: 180 }
  );

  if (latitudeRightTop <= latitudeLeftBottom) {
    throw new RequestValidationError(
      "Верхняя граница карты должна быть севернее нижней",
      "latitude_right_top"
    );
  }
  if (longitudeRightTop <= longitudeLeftBottom) {
    throw new RequestValidationError(
      "Правая граница карты должна быть восточнее левой",
      "longitude_right_top"
    );
  }

  return removeUndefined({
    latitude_right_top: latitudeRightTop,
    longitude_right_top: longitudeRightTop,
    latitude_left_bottom: latitudeLeftBottom,
    longitude_left_bottom: longitudeLeftBottom,
    type: parseOptionalOfficeType(data.type),
    have_cashless: parseOptionalBoolean(data.have_cashless, "have_cashless"),
    have_cash: parseOptionalBoolean(data.have_cash, "have_cash"),
    allowed_cod: parseOptionalBoolean(data.allowed_cod, "allowed_cod"),
    is_dressing_room: parseOptionalBoolean(data.is_dressing_room, "is_dressing_room"),
    is_handout: parseOptionalBoolean(data.is_handout, "is_handout"),
    is_handout_only: parseOptionalBoolean(data.is_handout_only, "is_handout_only"),
    is_reception: parseOptionalBoolean(data.is_reception, "is_reception"),
  });
};

const PUBLIC_PACKAGE_PRESETS = [
  { width: 30, height: 20, length: 3, weight: 0.3, weightGrams: 300 },
  { width: 35, height: 35, length: 7, weight: 0.8, weightGrams: 800 },
];

const buildCdekCalculatePayload = (data) => {
  ensurePlainObject(data, "body");
  assertAllowedKeys(data, CALCULATE_FIELDS, "расчёте СДЭК");

  const destination = ensurePlainObject(data.to_location, "to_location");
  assertAllowedKeys(destination, new Set(["code"]), "to_location");
  const destinationCode = readPositiveInteger(destination.code, "to_location.code", {
    min: 1,
    max: 10_000_000,
  });

  if (!Array.isArray(data.packages) || data.packages.length !== 1) {
    throw new RequestValidationError("Расчёт поддерживает ровно одно отправление", "packages");
  }
  const parcel = ensurePlainObject(data.packages[0], "packages[0]");
  assertAllowedKeys(parcel, new Set(["width", "height", "length", "weight"]), "packages[0]");
  const matchesPreset = PUBLIC_PACKAGE_PRESETS.find((preset) =>
    ["width", "height", "length", "weight"].every(
      (field) => typeof parcel[field] === "number" && parcel[field] === preset[field]
    )
  );
  if (!matchesPreset) {
    throw new RequestValidationError("Параметры отправления не поддерживаются", "packages[0]");
  }

  if (data.currency != null && !["number", "string"].includes(typeof data.currency)) {
    throw new RequestValidationError("Некорректная валюта", "currency");
  }
  const currency = Number(data.currency ?? 1);
  if (currency !== 1) throw new RequestValidationError("Поддерживается только валюта RUB", "currency");
  const lang = readString(data.lang, "lang", { max: 3 }).toLowerCase() || "rus";
  if (lang !== "rus") throw new RequestValidationError("Поддерживается только русский язык", "lang");

  return {
    type: 1,
    currency: 1,
    lang: "rus",
    from_location: getCdekFromLocation(),
    to_location: { code: destinationCode },
    packages: [{
      number: "1",
      width: matchesPreset.width,
      height: matchesPreset.height,
      length: matchesPreset.length,
      weight: matchesPreset.weightGrams,
    }],
  };
};

module.exports = {
  buildCdekCalculatePayload,
  buildCdekOfficesByCoordinateParams,
  buildCdekOfficesParams,
};
