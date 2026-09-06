const createRateLimiter = ({ windowMs, max, keyPrefix, message }) => {
  const entries = new Map();
  let lastCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      lastCleanup = now;
      for (const [key, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(key);
      }
    }

    const identity = req.user?.phone || req.user?.id || req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${req.user?.role || "anonymous"}:${identity}`;
    const requestLimit = typeof max === "function" ? max(req) : max;
    let entry = entries.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, requestLimit - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.set({
      "RateLimit-Limit": String(requestLimit),
      "RateLimit-Remaining": String(remaining),
      "RateLimit-Reset": String(resetSeconds),
    });

    if (entry.count > requestLimit) {
      res.set("Retry-After", String(resetSeconds));
      return res.status(429).json({ message });
    }

    return next();
  };
};

const adminUploadRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: "admin-upload",
  message: "Слишком много загрузок. Повторите попытку позднее",
});

const orderCreateRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 6,
  keyPrefix: "order-create",
  message: "Слишком много попыток оформления заказа. Повторите попытку позднее",
});

module.exports = {
  adminUploadRateLimit,
  createRateLimiter,
  orderCreateRateLimit,
};
