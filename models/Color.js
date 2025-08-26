const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Color = sequelize.define('Color', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  code: {
    type: DataTypes.STRING(7), // #RRGGBB
    allowNull: false,
  },
}, {
  tableName: 'colors',
  timestamps: false,
});

module.exports = Color;
