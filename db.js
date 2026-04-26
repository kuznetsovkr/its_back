const { Sequelize } = require("sequelize");
require("dotenv").config();

const ENABLE_SQL_LOGGING = process.env.ENABLE_SQL_LOGGING === "1";

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: "postgres",
    port: process.env.DB_PORT,
    logging: ENABLE_SQL_LOGGING ? console.log : false,
  }
);

module.exports = sequelize;
