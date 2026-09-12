const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const positivePrice = () => ({
  type: DataTypes.INTEGER,
  allowNull: false,
  validate: { min: 1 },
});

const nonNegativePrice = () => ({
  type: DataTypes.INTEGER,
  allowNull: false,
  validate: { min: 0 },
});

const PricingConfig = sequelize.define("pricingConfig", {
  id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    primaryKey: true,
  },
  patronusTshirtPrice: positivePrice(),
  patronusSvitshotPrice: positivePrice(),
  patronusHoodiePrice: positivePrice(),
  carTshirtPrice: positivePrice(),
  carSvitshotPrice: positivePrice(),
  carHoodiePrice: positivePrice(),
  petFaceTshirtPrice: positivePrice(),
  petFaceSvitshotPrice: positivePrice(),
  petFaceHoodiePrice: positivePrice(),
  additionalPatronusPrice: nonNegativePrice(),
  additionalPetFacePrice: nonNegativePrice(),
}, {
  tableName: "pricing_configs",
});

module.exports = PricingConfig;
