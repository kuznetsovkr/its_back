require("dotenv").config();
const createDatabaseConfig = require("./createDatabaseConfig");

const buildConfig = () => ({
  ...createDatabaseConfig(),
  migrationStorage: "sequelize",
  migrationStorageTableName: "SequelizeMeta",
});

module.exports = {
  development: buildConfig(),
  test: buildConfig(),
  production: buildConfig(),
};
