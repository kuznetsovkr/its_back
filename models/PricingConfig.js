const { DataTypes } = require("sequelize");
const sequelize = require("../db");

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
  additionalPatronusPrice: nonNegativePrice(),
  additionalPetFacePrice: nonNegativePrice(),
}, {
  tableName: "pricing_configs",
});

module.exports = PricingConfig;
