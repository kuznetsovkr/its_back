const normalizeOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch (_error) {
    return null;
  }
};

const requireTrustedOrigin = (req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();

  const configuredOrigins = String(
    process.env.ALLOWED_PUBLIC_ORIGINS || process.env.PUBLIC_APP_URL || ""
  )
    .split(",")
    .map((value) => normalizeOrigin(value.trim()))
    .filter(Boolean);

  const requestOrigin =
    normalizeOrigin(req.header("Origin")) || normalizeOrigin(req.header("Referer"));
  if (!requestOrigin || !configuredOrigins.includes(requestOrigin)) {
    return res.status(403).json({ message: "Источник запроса не разрешён" });
  }

  return next();
};

module.exports = requireTrustedOrigin;
