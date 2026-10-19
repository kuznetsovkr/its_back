const CAR_DESIGNS = Object.freeze({
  simple: { label: "Простой дизайн", size: "около 15 см", field: "carSimplePrice" },
  medium: { label: "Средний дизайн", size: "23 см", field: "carMediumPrice" },
  complex: { label: "Сложный дизайн", size: "30 см", field: "carComplexPrice" },
});

const getCarDesignPrices = (profile = {}) => Object.fromEntries(
  Object.entries(CAR_DESIGNS).map(([key, design]) => {
    const price = profile[design.field];
    return [key, profile.code === "tshirt" && key === "complex" ? null
      : Number.isSafeInteger(price) && price > 0 ? price : null];
  })
);
const getCarEmbroideryLabel = (design) => Object.hasOwn(CAR_DESIGNS, design || "")
  ? `Автомобиль — ${CAR_DESIGNS[design].label.toLowerCase()} (${CAR_DESIGNS[design].size})`
  : "Автомобиль";

module.exports = { CAR_DESIGNS, getCarDesignPrices, getCarEmbroideryLabel };
