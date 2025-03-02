const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const Inventory = sequelize.define("inventory", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    productType: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    color: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    size: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    imageUrl: { // ✅ Добавляем поле для изображения
        type: DataTypes.STRING,
        allowNull: true,
    }
});

module.exports = Inventory;
