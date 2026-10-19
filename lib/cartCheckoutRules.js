const crypto = require("node:crypto");
const { CartError } = require("./cartRules");
const { ensurePlainObject, assertAllowedKeys, readString, readName, normalizeRuPhone, RequestValidationError } = require("./requestValidation");
const { readPostalDestination } = require("./postalDelivery");
const QUOTE_FIELDS = ["revision", "officeCode", "certificateCode", "deliveryMethod", "postalPoint", "deliveryCityToken"];
const readQuote = (body) => {
  const revision = body.revision;
  if (!Number.isInteger(revision) || revision < 0 || revision > 2_000_000_000) throw new RequestValidationError("Обновите состав корзины", "revision");
  const deliveryMethod = readString(body.deliveryMethod, "deliveryMethod", { max: 24 }) || "cdek";
  if (!["cdek", "russian_post"].includes(deliveryMethod)) throw new RequestValidationError("Для оплаты корзины выберите СДЭК или Почту России", "deliveryMethod");
  const officeCode = readString(body.officeCode, "officeCode", { required: deliveryMethod === "cdek", max: 32 });
  if (deliveryMethod === "cdek" && !/^[\p{L}\p{N}_-]+$/u.test(officeCode)) throw new RequestValidationError("Выберите корректный ПВЗ СДЭК", "officeCode");
  if (deliveryMethod === "russian_post" && officeCode) throw new RequestValidationError("ПВЗ СДЭК не соответствует почтовой доставке", "officeCode");
  const postal = deliveryMethod === "russian_post" ? readPostalDestination(body.postalPoint, body.deliveryCityToken) : {};
  return { revision, officeCode, certificateCode: readString(body.certificateCode, "certificateCode", { max: 80 }), deliveryMethod, ...postal };
};
const validateCartQuote = (body) => {
  ensurePlainObject(body, "body"); assertAllowedKeys(body, new Set(QUOTE_FIELDS), "расчёте корзины");
  return readQuote(body);
};
const validateCartCheckout = (body) => {
  ensurePlainObject(body, "body");
  assertAllowedKeys(body, new Set([...QUOTE_FIELDS, "buyer", "quoteHash", "turnstileToken"]), "оформлении корзины");
  const buyer = ensurePlainObject(body.buyer, "buyer");
  assertAllowedKeys(buyer, new Set(["firstName", "lastName", "middleName", "phone", "recipientFullName", "recipientPhoneDigits", "email", "preferredContact", "comment", "deliveryComment", "privacyConsent"]), "данных покупателя");
  if (buyer.privacyConsent !== true) throw new RequestValidationError("Необходимо согласие на обработку персональных данных", "privacyConsent");
  const firstName = readName(buyer.firstName, "firstName", true);
  const lastName = readName(buyer.lastName, "lastName", true);
  const middleName = readName(buyer.middleName, "middleName", false);
  const phone = normalizeRuPhone(buyer.phone);
  const separateName = readString(buyer.recipientFullName, "recipientFullName", { max: 200 });
  const separatePhone = readString(buyer.recipientPhoneDigits, "recipientPhoneDigits", { max: 32 });
  if (separateName && !separatePhone) throw new RequestValidationError("Укажите телефон другого получателя", "recipientPhoneDigits");
  if (separatePhone && !separateName) throw new RequestValidationError("Укажите ФИО другого получателя", "recipientFullName");
  const email = readString(buyer.email, "email", { max: 254 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestValidationError("Некорректный e-mail", "email");
  const quoteHash = readString(body.quoteHash, "quoteHash", { required: true, max: 64 });
  if (!/^[a-f0-9]{64}$/.test(quoteHash)) throw new CartError("Пересчитайте стоимость корзины", "cart_quote_required", 400);
  return { ...readQuote(body), quoteHash, turnstileToken: readString(body.turnstileToken, "turnstileToken", { max: 2048 }), buyer: {
    firstName, lastName, middleName, phone,
    recipientFullName: separateName || [lastName, firstName, middleName].filter(Boolean).join(" "),
    recipientPhone: separatePhone ? normalizeRuPhone(separatePhone, "recipientPhoneDigits") : phone,
    email, preferredContact: readString(buyer.preferredContact, "preferredContact", { max: 80 }),
    comment: readString(buyer.comment, "comment", { max: 2500, multiline: true }),
    deliveryComment: readString(buyer.deliveryComment, "deliveryComment", { max: 500, multiline: true }),
  } };
};
const hashCheckout = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assertCartRevision = (cart, revision) => {
  if (cart.revision !== revision) throw new CartError("Корзина изменилась в другой вкладке. Обновите состав и пересчитайте стоимость", "cart_changed");
};
const assertCartMutable = (cart) => {
  if (cart.checkoutOrderId) throw new CartError("Заказ уже создан. Завершите оплату или отмените оформление, чтобы изменить корзину", "cart_checkout_locked");
};
module.exports = { validateCartQuote, validateCartCheckout, hashCheckout, assertCartRevision, assertCartMutable };
