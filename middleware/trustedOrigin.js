const { getAllowedOrigins, normalizeOrigin } = require("./corsPolicy");

const requireTrustedOrigin = (req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();

  const configuredOrigins = getAllowedOrigins();

  const requestOrigin =
    normalizeOrigin(req.header("Origin")) || normalizeOrigin(req.header("Referer"));
  if (!requestOrigin || !configuredOrigins.has(requestOrigin)) {
    return res.status(403).json({ message: "Источник запроса не разрешён" });
  }

  return next();
};

module.exports = requireTrustedOrigin;
