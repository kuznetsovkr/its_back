const createDatabaseConfig = (env = process.env) => ({
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 5432),
  dialect: "postgres",
  logging: env.ENABLE_SQL_LOGGING === "1" ? console.log : false,
});

module.exports = createDatabaseConfig;
