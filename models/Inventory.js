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
    imageUrl: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    colorCode: {
        type: DataTypes.STRING(7),
        allowNull: true,
    },
}, {indexes: [{ unique: true, fields: ["productType", "color", "size"] }],
});

module.exports = Inventory;
