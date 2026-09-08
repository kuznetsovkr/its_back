const { Sequelize } = require("sequelize");
require("dotenv").config();
const createDatabaseConfig = require("./config/createDatabaseConfig");

const { database, username, password, ...options } = createDatabaseConfig();

const sequelize = new Sequelize(database, username, password, options);

module.exports = sequelize;
