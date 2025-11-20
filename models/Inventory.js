const { DataTypes } = require("sequelize");
const sequelize = require("../db");
const ClothingType = require("./ClothingType");

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
    clothingTypeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: "clothingTypes",
            key: "id",
        },
        onDelete: "SET NULL",
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

Inventory.belongsTo(ClothingType, {
    foreignKey: "clothingTypeId",
    as: "clothingType",
});

module.exports = Inventory;
