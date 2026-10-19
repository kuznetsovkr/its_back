const { ensurePlainObject, assertAllowedKeys, readString, readPositiveInteger, readPatronusCount, readPetFaceCount, readCarDesign, RequestValidationError } = require("../lib/requestValidation");
const { issueCdekQuoteContext } = require("../lib/cdekQuoteContext");
const { combineShippingPackages } = require("../lib/shippingPackages");
const { findInventoryForOrder } = require("./inventoryResolver");
const { getPricingExtras } = require("./pricingConfig");
const { calculateMerchandisePrice, getGoodsPreset, PricingError } = require("./orderPricing");
const FIELDS = new Set(["productType", "color", "size", "embroideryType", "carDesign", "patronusCount", "petFaceCount", "quantity"]);
// Public catalog data only: no cart access tokens, certificate codes, contacts or photos.
const createShippingQuoteContext = async (body) => {
  ensurePlainObject(body, "body"); assertAllowedKeys(body, new Set(["items"]), "параметрах доставки");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) throw new RequestValidationError("Укажите от 1 до 20 изделий", "items");
  let units = 0;
  const items = body.items.map(item => {
    ensurePlainObject(item, "item"); assertAllowedKeys(item, FIELDS, "изделии для доставки");
    const quantity = readPositiveInteger(item.quantity ?? 1, "quantity", { min: 1, max: 20 });
    units += quantity;
    const embroideryType = readString(item.embroideryType, "embroideryType", { required: true, max: 32 });
    return { productType: readString(item.productType, "productType", { required: true, max: 120 }),
      color: readString(item.color, "color", { required: true, max: 80 }), size: readString(item.size, "size", { required: true, max: 16 }),
      embroideryType, carDesign: readCarDesign(item.carDesign, embroideryType),
      patronusCount: embroideryType === "Patronus" ? readPatronusCount(item.patronusCount ?? 1) : 1,
      petFaceCount: embroideryType === "petFace" ? readPetFaceCount(item.petFaceCount ?? 1) : 1, quantity };
  });
  if (units > 50) throw new RequestValidationError("В заказе может быть не более 50 изделий", "items");
  const pricingConfig = { additional: await getPricingExtras() };
  const parcels = []; let declaredValue = 0;
  for (const item of items) {
    const inventory = await findInventoryForOrder(item.productType, item.color, item.size);
    if (!inventory || inventory.quantity < item.quantity) throw new PricingError("Выбранного изделия нет в наличии", 409, "cdek_stock_unavailable");
    const quote = calculateMerchandisePrice({ ...item, inventory, pricingConfig });
    if (quote.manual && items.length !== 1) throw new RequestValidationError("Индивидуальную вышивку нужно оформить отдельно", "items");
    declaredValue = quote.manual ? null : declaredValue + quote.merchandisePrice * item.quantity;
    for (let unit = 0; unit < item.quantity; unit++) parcels.push(getGoodsPreset(inventory));
  }
  const packages = combineShippingPackages(parcels);
  return { token: issueCdekQuoteContext({ packages, declaredValue }), packages, pricePending: declaredValue === null };
};
module.exports = { createShippingQuoteContext };
