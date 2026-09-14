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
    code: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    displayOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        validate: { min: 1 },
    },
    sizeGuideKey: {
        type: DataTypes.STRING(32),
        allowNull: true,
    },
    patronusLimit: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
        validate: { min: 1, max: 5 },
    },
    packageWidth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 35,
        validate: { min: 1 },
    },
    packageHeight: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 35,
        validate: { min: 1 },
    },
    packageLength: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 7,
        validate: { min: 1 },
    },
    packageWeight: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 800,
        validate: { min: 1 },
    },
    patronusPrice: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
    },
    carPrice: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
    },
    petFacePrice: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1 },
    },
});

module.exports = ClothingType;
