const crypto = require("node:crypto");
const ClothingType = require("../models/ClothingType");

const CLOTHING_TYPE_ATTRIBUTES = Object.freeze([
  "id",
  "name",
  "code",
  "displayOrder",
  "sizeGuideKey",
  "patronusLimit",
  "packageWidth",
  "packageHeight",
  "packageLength",
  "packageWeight",
  "patronusPrice",
  "carPrice",
  "petFacePrice",
]);

const asPlain = (record) =>
  typeof record?.get === "function" ? record.get({ plain: true }) : record;

const getTypePrices = (record) => {
  const value = asPlain(record) || {};
  return {
    Patronus: value.patronusPrice ?? null,
    Car: value.carPrice ?? null,
    petFace: value.petFacePrice ?? null,
  };
};

const getStartingPriceForType = (record) => {
  const prices = Object.values(getTypePrices(record))
    .filter((price) => Number.isInteger(price) && price > 0);
  return prices.length ? Math.min(...prices) : null;
};

const serializeClothingType = (record) => {
  const value = asPlain(record) || {};
  return {
    id: value.id,
    name: value.name,
    code: value.code,
    displayOrder: value.displayOrder,
    sizeGuideKey: value.sizeGuideKey || null,
    patronusLimit: value.patronusLimit,
    prices: getTypePrices(value),
    package: {
      width: value.packageWidth,
      height: value.packageHeight,
      length: value.packageLength,
      weight: value.packageWeight,
    },
    price: getStartingPriceForType(value),
  };
};

const createGeneratedTypeCode = () => `type-${crypto.randomUUID()}`;

const getShippingPackageProfiles = async (options = {}) => {
  const types = await ClothingType.findAll({
    attributes: ["packageWidth", "packageHeight", "packageLength", "packageWeight"],
    ...options,
  });
  const unique = new Map();
  for (const record of types) {
    const value = asPlain(record);
    const profile = {
      width: value.packageWidth,
      height: value.packageHeight,
      length: value.packageLength,
      weight: value.packageWeight,
    };
    unique.set(Object.values(profile).join(":"), profile);
  }
  return [...unique.values()];
};

module.exports = {
  CLOTHING_TYPE_ATTRIBUTES,
  createGeneratedTypeCode,
  getShippingPackageProfiles,
  getStartingPriceForType,
  getTypePrices,
  serializeClothingType,
};
