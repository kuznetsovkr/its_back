const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const User = sequelize.define("user", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    phone: { type: DataTypes.STRING, allowNull: false, unique: true },
    firstName: { type: DataTypes.STRING, allowNull: true }, // 👈 Может быть null
    lastName: { type: DataTypes.STRING, allowNull: true },  // 👈 Может быть null
    middleName: { type: DataTypes.STRING, allowNull: true }, // Добавили отчество
    birthDate: { type: DataTypes.DATEONLY, allowNull: true }, // 👈 Может быть null
});

module.exports = User;
