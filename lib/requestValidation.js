class RequestValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "RequestValidationError";
    this.statusCode = 400;
    this.code = "validation_failed";
    this.field = field;
  }
}

const fail = (message, field) => {
  throw new RequestValidationError(message, field);
};

const ensurePlainObject = (value, field) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`Поле ${field} имеет некорректный формат`, field);
  }
  return value;
};

const parseJsonObject = (value, field) => {
  if (value && typeof value === "object") return ensurePlainObject(value, field);
  if (typeof value !== "string" || !value.trim()) fail(`Поле ${field} обязательно`, field);
  try {
    return ensurePlainObject(JSON.parse(value), field);
  } catch (error) {
    if (error instanceof RequestValidationError) throw error;
    fail(`Поле ${field} содержит некорректный JSON`, field);
  }
};

const readString = (
  value,
  field,
  { required = false, min = required ? 1 : 0, max = 255, multiline = false } = {}
) => {
  if (value == null) value = "";
  if (typeof value !== "string") fail(`Поле ${field} должно быть строкой`, field);
  const normalized = value.trim();
  if (required && !normalized) fail(`Поле ${field} обязательно`, field);
  if (normalized.length < min || normalized.length > max) {
    fail(`Поле ${field} должно содержать от ${min} до ${max} символов`, field);
  }
  const containsForbiddenControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    if (code === 127) return true;
    if (code > 31) return false;
    return !multiline || ![9, 10, 13].includes(code);
  });
  if (containsForbiddenControlCharacter) {
    fail(`Поле ${field} содержит недопустимые символы`, field);
  }
  return normalized;
};

const readName = (value, field, required = false) => {
  const name = readString(value, field, { required, max: 80 });
  if (name && !/^[\p{L}][\p{L}\p{M}'’\- ]*$/u.test(name)) {
    fail(`Поле ${field} содержит недопустимые символы`, field);
  }
  return name;
};

const normalizeRuPhone = (value, field = "phone") => {
  if (typeof value !== "string") fail(`Поле ${field} должно быть строкой`, field);
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (!/^7\d{10}$/.test(digits)) fail("Введите корректный номер телефона", field);
  return `+${digits}`;
};

const readPositiveInteger = (value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (typeof value !== "string" && typeof value !== "number") {
    fail(`Поле ${field} должно быть целым числом`, field);
  }
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    fail(`Поле ${field} должно быть целым числом`, field);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(`Поле ${field} должно быть целым числом от ${min} до ${max}`, field);
  }
  return number;
};

const assertAllowedKeys = (object, allowedKeys, context = "запрос") => {
  const unexpected = Object.keys(object || {}).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) fail(`Неизвестные поля в ${context}: ${unexpected.join(", ")}`);
};

const ORDER_FIELDS = new Set([
  "firstName",
  "lastName",
  "middleName",
  "phone",
  "recipientPhoneDigits",
  "recipientFullName",
  "email",
  "preferredContact",
  "deliveryComment",
  "deliveryCity",
  "privacyConsent",
  "productType",
  "color",
  "size",
  "embroideryType",
  "embroideryTypeRu",
  "patronusCount",
  "petFaceCount",
  "customText",
  "customOption",
  "comment",
  "deliveryAddress",
  "cdekMode",
  "cdekAddress",
  "cdekAddressLabel",
  "cdekPvzCode",
  "cdekCode",
]);

const EMBROIDERY_TYPES = new Map([
  ["patronus", "Patronus"],
  ["car", "Car"],
  ["petface", "petFace"],
  ["custom", "custom"],
]);

const EMBROIDERY_LABELS = Object.freeze({
  Patronus: "Патронус",
  Car: "Автомобиль",
  petFace: "Мордочка питомца",
});

const validateOrderCreateInput = (body, files = []) => {
  ensurePlainObject(body, "body");
  assertAllowedKeys(body, ORDER_FIELDS, "заказе");

  const firstName = readName(body.firstName, "firstName", true);
  const lastName = readName(body.lastName, "lastName", true);
  const middleName = readName(body.middleName, "middleName", false);
  const phone = normalizeRuPhone(body.phone);
  const productType = readString(body.productType, "productType", { required: true, max: 120 });
  const color = readString(body.color, "color", { required: true, max: 80 });
  const size = readString(body.size, "size", { required: true, max: 16 });
  if (!/^[\p{L}\p{N}\-+./ ]+$/u.test(size)) fail("Некорректный размер изделия", "size");

  const rawEmbroideryType = readString(body.embroideryType, "embroideryType", {
    required: true,
    max: 32,
  }).toLowerCase();
  const embroideryType = EMBROIDERY_TYPES.get(rawEmbroideryType);
  if (!embroideryType) fail("Неизвестный тип вышивки", "embroideryType");

  const patronusCount = readPositiveInteger(body.patronusCount, "patronusCount", { max: 5 });
  const petFaceCount = readPositiveInteger(body.petFaceCount, "petFaceCount", { max: 5 });
  const customText = readString(body.customText, "customText", { max: 500, multiline: true });
  const comment = readString(body.comment, "comment", { max: 2500, multiline: true });
  const deliveryAddress = readString(body.deliveryAddress, "deliveryAddress", {
    required: true,
    max: 300,
  });

  if (String(body.privacyConsent).toLowerCase() !== "true") {
    fail("Необходимо согласие на обработку персональных данных", "privacyConsent");
  }

  const fileCount = Array.isArray(files) ? files.length : 0;
  let customOption = {};
  let embroideryTypeRu = EMBROIDERY_LABELS[embroideryType] || "";
  if (embroideryType === "custom") {
    customOption = parseJsonObject(body.customOption, "customOption");
    assertAllowedKeys(customOption, new Set(["image", "text"]), "customOption");
    if (typeof customOption.image !== "boolean" || typeof customOption.text !== "boolean") {
      fail("Параметры индивидуальной вышивки должны быть логическими значениями", "customOption");
    }
    if (customOption.image === customOption.text) {
      fail("Выберите изображение или надпись для индивидуальной вышивки", "customOption");
    }
    if (customOption.image && fileCount < 1) {
      fail("Загрузите изображение для индивидуальной вышивки", "images");
    }
    if (customOption.text && !customText) {
      fail("Введите текст для индивидуальной вышивки", "customText");
    }
    embroideryTypeRu = customOption.text
      ? "Своя вышивка — надпись"
      : "Своя вышивка — изображение";
  } else if (fileCount < 1) {
    fail("Загрузите хотя бы одно изображение для вышивки", "images");
  }

  if (embroideryType === "petFace" && fileCount > 5) {
    fail("Для портрета питомца можно загрузить не более 5 изображений", "images");
  }

  const cdekMode = readString(body.cdekMode, "cdekMode", { max: 16 }).toLowerCase();
  let cdekAddress = null;
  if (cdekMode) {
    if (cdekMode !== "office") fail("Поддерживается только доставка до ПВЗ СДЭК", "cdekMode");
    cdekAddress = parseJsonObject(body.cdekAddress, "cdekAddress");
    const officeCode = readString(
      cdekAddress.code || cdekAddress.office_code,
      "cdekAddress.code",
      { required: true, max: 32 }
    );
    if (!/^[\p{L}\p{N}_-]+$/u.test(officeCode)) {
      fail("Некорректный код ПВЗ СДЭК", "cdekAddress.code");
    }
    // Остальные данные ПВЗ считаются недоверенными: адрес и город сервер
    // повторно получает у СДЭК по этому коду.
    cdekAddress = { code: officeCode };
  }

  const recipientFullName = readString(body.recipientFullName, "recipientFullName", { max: 200 });
  const recipientPhone = body.recipientPhoneDigits
    ? normalizeRuPhone(String(body.recipientPhoneDigits), "recipientPhoneDigits")
    : phone;
  if (body.email) {
    const email = readString(body.email, "email", { max: 254 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Некорректный e-mail", "email");
  }
  readString(body.preferredContact, "preferredContact", { max: 80 });
  readString(body.deliveryComment, "deliveryComment", { max: 500, multiline: true });
  readString(body.deliveryCity, "deliveryCity", { max: 120 });
  readString(body.cdekAddressLabel, "cdekAddressLabel", { max: 300 });

  return {
    firstName,
    lastName,
    middleName,
    phone,
    recipientPhone,
    recipientFullName: recipientFullName || [lastName, firstName, middleName].filter(Boolean).join(" "),
    productType,
    color,
    size,
    embroideryType,
    embroideryTypeRu,
    patronusCount,
    petFaceCount,
    customText,
    customOption,
    comment,
    deliveryAddress,
    cdekMode,
    cdekAddress,
  };
};

module.exports = {
  RequestValidationError,
  assertAllowedKeys,
  ensurePlainObject,
  normalizeRuPhone,
  parseJsonObject,
  readPositiveInteger,
  readString,
  validateOrderCreateInput,
};
