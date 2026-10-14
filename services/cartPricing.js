const { PricingError } = require("./orderPricing");

// Read-only estimate. It neither reserves stock nor includes delivery/payment.
const quoteCartItems = async (items, { findInventory, calculatePrice, getPricingExtras }) => {
  if (!items.length) return { items: [], merchandisePrice: 0 };
  const pricingConfig = { additional: await getPricingExtras() };
  const quoted = await Promise.all(items.map(async (item) => {
    const inventory = await findInventory(item.productType, item.color, item.size);
    if (!inventory || inventory.id !== item.inventoryId) {
      return { ...item, unitPrice: null, linePrice: null, pricingError: "Изделие больше недоступно в каталоге" };
    }
    try {
      const price = calculatePrice({ inventory, embroideryType: item.embroideryType,
        patronusCount: item.patronusCount, petFaceCount: item.petFaceCount, pricingConfig });
      if (price.manual || !Number.isSafeInteger(price.merchandisePrice) || price.merchandisePrice <= 0) {
        throw new PricingError("Для изделия требуется расчёт менеджера");
      }
      const required = items.filter((entry) => entry.inventoryId === inventory.id).reduce((sum, entry) => sum + entry.quantity, 0);
      return { ...item, unitPrice: price.merchandisePrice, linePrice: price.merchandisePrice * item.quantity,
        pricingError: "", stockWarning: required > inventory.quantity ? "Выбранного количества сейчас нет на складе" : "" };
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      return { ...item, unitPrice: null, linePrice: null, pricingError: error.message };
    }
  }));
  return { items: quoted, merchandisePrice: quoted.some((item) => item.linePrice == null)
    ? null : quoted.reduce((sum, item) => sum + item.linePrice, 0) };
};

module.exports = { quoteCartItems };
