const { DataTypes } = require("sequelize");
const sequelize = require("../db");

const User = sequelize.define("user", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    phone: { type: DataTypes.STRING, allowNull: false, unique: true },
    firstName: { type: DataTypes.STRING, allowNull: true }, 
    lastName: { type: DataTypes.STRING, allowNull: true },  
    middleName: { type: DataTypes.STRING, allowNull: true },
    birthDate: { type: DataTypes.DATEONLY, allowNull: true }, 
    role: { type: DataTypes.STRING, allowNull: false, defaultValue: "user" },
});

module.exports = User;
