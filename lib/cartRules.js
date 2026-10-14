const { RequestValidationError, assertAllowedKeys, ensurePlainObject, readPositiveInteger,
  readPatronusCount, readPetFaceCount, readString } = require("./requestValidation");

const CART_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_CART_ITEMS = 20;
const MAX_CART_QUANTITY = 50;
const MAX_ITEM_QUANTITY = 20;
const MAX_CART_BYTES = 50 * 1024 * 1024;

class CartError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const readUuid = (value, field = "id") => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new RequestValidationError("Некорректный идентификатор корзины или изделия", field);
  }
  return value.toLowerCase();
};
const ITEM_FIELDS = new Set(["productType", "color", "size", "embroideryType", "patronusCount", "petFaceCount", "comment", "turnstileToken", "privacyConsent"]);
const LABELS = { Patronus: "Патронус", Car: "Автомобиль", petFace: "Мордочка питомца" };
const TYPES = new Map([["patronus", "Patronus"], ["car", "Car"], ["petface", "petFace"]]);

const validateCartItem = (body, files) => {
  ensurePlainObject(body, "body");
  assertAllowedKeys(body, ITEM_FIELDS, "изделии корзины");
  if (String(body.privacyConsent).toLowerCase() !== "true") throw new RequestValidationError("Для сохранения фотографий необходимо согласие на обработку данных", "privacyConsent");
  const rawType = readString(body.embroideryType, "embroideryType", { required: true, max: 32 }).toLowerCase();
  if (rawType === "custom") throw new CartError("Индивидуальную вышивку нужно оформить отдельной заявкой", "cart_manual_item", 400);
  const embroideryType = TYPES.get(rawType);
  if (!embroideryType) throw new RequestValidationError("Выберите поддерживаемый тип вышивки", "embroideryType");
  if (!Array.isArray(files) || files.length < 1 || files.length > (embroideryType === "petFace" ? 5 : 10)) {
    throw new RequestValidationError(embroideryType === "petFace"
      ? "Для мордочки питомца загрузите от 1 до 5 фотографий" : "Загрузите от 1 до 10 фотографий для вышивки", "images");
  }
  return {
    productType: readString(body.productType, "productType", { required: true, max: 120 }),
    color: readString(body.color, "color", { required: true, max: 80 }),
    size: readString(body.size, "size", { required: true, max: 16 }),
    embroideryType,
    embroideryTypeRu: LABELS[embroideryType],
    patronusCount: embroideryType === "Patronus" ? readPatronusCount(body.patronusCount ?? 1) : 1,
    petFaceCount: embroideryType === "petFace" ? readPetFaceCount(body.petFaceCount ?? 1) : 1,
    comment: readString(body.comment, "comment", { max: 2500, multiline: true }),
    turnstileToken: readString(body.turnstileToken, "turnstileToken", { max: 2048 }),
    privacyConsent: true,
  };
};

const validateCartQuantity = (body) => {
  ensurePlainObject(body, "body");
  assertAllowedKeys(body, new Set(["quantity"]), "количестве изделий");
  return readPositiveInteger(body.quantity, "quantity", { max: MAX_ITEM_QUANTITY });
};

const assertCartCapacity = ({ items, bytes, addedBytes = 0, addedQuantity = 0, addedItems = 0 }) => {
  const active = items.filter((item) => !item.deletedAt);
  if (active.length + addedItems > MAX_CART_ITEMS) throw new CartError("В корзине может быть не более 20 разных изделий", "cart_item_limit");
  if (active.reduce((total, item) => total + item.quantity, 0) + addedQuantity > MAX_CART_QUANTITY) {
    throw new CartError("В корзине может быть не более 50 изделий", "cart_quantity_limit");
  }
  if (bytes + addedBytes > MAX_CART_BYTES) throw new CartError("Фотографии в корзине занимают больше 50 МБ. Удалите лишние изделия или уменьшите изображения", "cart_storage_limit");
};

module.exports = { CartError, CART_RETENTION_MS, MAX_CART_BYTES, MAX_CART_ITEMS, MAX_CART_QUANTITY, MAX_ITEM_QUANTITY,
  assertCartCapacity, readUuid, validateCartItem, validateCartQuantity };
