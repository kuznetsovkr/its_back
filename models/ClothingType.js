const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const ClothingType = sequelize.define("clothingType", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    price: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
});

module.exports = ClothingType;
