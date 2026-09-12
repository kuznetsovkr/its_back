const PricingConfig = require("../models/PricingConfig");

const CONFIG_ID = 1;

const toDomainConfig = (record) => {
  if (!record) {
    const error = new Error("Конфигурация цен не найдена");
    error.code = "pricing_config_missing";
    throw error;
  }

  const value = typeof record.get === "function" ? record.get({ plain: true }) : record;
  return {
    currency: "RUB",
    matrix: {
      Patronus: {
        tshirt: value.patronusTshirtPrice,
        svitshot: value.patronusSvitshotPrice,
        hoodie: value.patronusHoodiePrice,
      },
      Car: {
        tshirt: value.carTshirtPrice,
        svitshot: value.carSvitshotPrice,
        hoodie: value.carHoodiePrice,
      },
      petFace: {
        tshirt: value.petFaceTshirtPrice,
        svitshot: value.petFaceSvitshotPrice,
        hoodie: value.petFaceHoodiePrice,
      },
    },
    additional: {
      Patronus: value.additionalPatronusPrice,
      petFace: value.additionalPetFacePrice,
    },
    updatedAt: value.updatedAt || null,
  };
};

const toPersistenceFields = (config) => ({
  patronusTshirtPrice: config.matrix.Patronus.tshirt,
  patronusSvitshotPrice: config.matrix.Patronus.svitshot,
  patronusHoodiePrice: config.matrix.Patronus.hoodie,
  carTshirtPrice: config.matrix.Car.tshirt,
  carSvitshotPrice: config.matrix.Car.svitshot,
  carHoodiePrice: config.matrix.Car.hoodie,
  petFaceTshirtPrice: config.matrix.petFace.tshirt,
  petFaceSvitshotPrice: config.matrix.petFace.svitshot,
  petFaceHoodiePrice: config.matrix.petFace.hoodie,
  additionalPatronusPrice: config.additional.Patronus,
  additionalPetFacePrice: config.additional.petFace,
});

const getPricingConfig = async (options = {}) => {
  const record = await PricingConfig.findByPk(CONFIG_ID, options);
  return toDomainConfig(record);
};

const updatePricingConfig = async (config) => {
  const record = await PricingConfig.findByPk(CONFIG_ID);
  if (!record) return getPricingConfig();
  await record.update(toPersistenceFields(config));
  return toDomainConfig(record);
};

module.exports = {
  CONFIG_ID,
  getPricingConfig,
  toDomainConfig,
  updatePricingConfig,
};
