const PricingConfig = require("../models/PricingConfig");
const ClothingType = require("../models/ClothingType");
const sequelize = require("../db");
const { serializeClothingType } = require("./clothingTypes");

const CONFIG_ID = 1;

const toDomainConfig = (record, clothingTypes = []) => {
  if (!record) {
    const error = new Error("Конфигурация цен не найдена");
    error.code = "pricing_config_missing";
    throw error;
  }

  const value = typeof record.get === "function" ? record.get({ plain: true }) : record;
  return {
    currency: "RUB",
    types: clothingTypes.map(serializeClothingType),
    additional: {
      Patronus: value.additionalPatronusPrice,
      petFace: value.additionalPetFacePrice,
    },
    updatedAt: value.updatedAt || null,
  };
};

const toPersistenceFields = (config) => ({
  additionalPatronusPrice: config.additional.Patronus,
  additionalPetFacePrice: config.additional.petFace,
});

const getPricingExtras = async (options = {}) => {
  const record = await PricingConfig.findByPk(CONFIG_ID, options);
  return toDomainConfig(record).additional;
};

const getPricingConfig = async (options = {}) => {
  const [record, clothingTypes] = await Promise.all([
    PricingConfig.findByPk(CONFIG_ID, options),
    ClothingType.findAll({
      order: [["displayOrder", "ASC"], ["name", "ASC"]],
      ...options,
    }),
  ]);
  return toDomainConfig(record, clothingTypes);
};

const updatePricingConfig = async (config) => {
  await sequelize.transaction(async (transaction) => {
    const [record, currentTypes] = await Promise.all([
      PricingConfig.findByPk(CONFIG_ID, { transaction, lock: transaction.LOCK.UPDATE }),
      ClothingType.findAll({ transaction, lock: transaction.LOCK.UPDATE }),
    ]);
    if (!record) {
      const error = new Error("Конфигурация цен не найдена");
      error.code = "pricing_config_missing";
      throw error;
    }

    const currentIds = new Set(currentTypes.map((type) => Number(type.id)));
    const incomingIds = new Set(config.types.map((type) => Number(type.id)));
    if (
      incomingIds.size !== config.types.length ||
      currentIds.size !== incomingIds.size ||
      [...currentIds].some((id) => !incomingIds.has(id))
    ) {
      const error = new Error("Список типов изделий изменился. Обновите страницу и повторите попытку");
      error.code = "stale_clothing_types";
      error.statusCode = 409;
      throw error;
    }

    await record.update(toPersistenceFields(config), { transaction });
    for (const type of config.types) {
      await ClothingType.update({
        displayOrder: type.displayOrder,
        sizeGuideKey: type.sizeGuideKey,
        patronusLimit: type.patronusLimit,
        packageWidth: type.package.width,
        packageHeight: type.package.height,
        packageLength: type.package.length,
        packageWeight: type.package.weight,
        patronusPrice: type.prices.Patronus,
        carPrice: type.prices.Car,
        petFacePrice: type.prices.petFace,
      }, { where: { id: type.id }, transaction });
    }
  });
  return getPricingConfig();
};

module.exports = {
  CONFIG_ID,
  getPricingConfig,
  getPricingExtras,
  toDomainConfig,
  updatePricingConfig,
};
