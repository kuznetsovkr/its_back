const { DataTypes } = require("sequelize");
const sequelize = require("../db");
const User = require("./User");

const Order = sequelize.define("order", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { 
        type: DataTypes.INTEGER, 
        allowNull: true, // ✅ Разрешаем `null` для неавторизованных пользователей
        references: {
            model: User,
            key: "id",
        },
        onDelete: "SET NULL", // ✅ Если пользователь удалён, оставляем заказ
    },
    phone: { type: DataTypes.STRING, allowNull: false },
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    middleName: { type: DataTypes.STRING, allowNull: true },
    productType: { type: DataTypes.STRING, allowNull: false },
    color: { type: DataTypes.STRING, allowNull: false },
    size: { type: DataTypes.STRING, allowNull: false },
    embroideryType: { type: DataTypes.STRING, allowNull: false },
    customText: { type: DataTypes.STRING, allowNull: true },
    uploadedImage: { type: DataTypes.STRING, allowNull: true },
    comment: { type: DataTypes.TEXT, allowNull: true },
    orderDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Сформировано" }, // ✅ Новый статус
});

module.exports = Order;
