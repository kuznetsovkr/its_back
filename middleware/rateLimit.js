const createRateLimiter = ({
  windowMs,
  max,
  keyPrefix,
  message,
  keyGenerator,
  maxEntries = 50_000,
}) => {
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

    const identity = keyGenerator
      ? keyGenerator(req)
      : req.user?.phone || req.user?.id || req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${req.user?.role || "anonymous"}:${identity}`;
    const requestLimit = typeof max === "function" ? max(req) : max;
    let entry = entries.get(key);

    if (!entry || entry.resetAt <= now) {
      if (!entries.has(key) && entries.size >= maxEntries) {
        entries.delete(entries.keys().next().value);
      }
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

const pricingQuoteRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyPrefix: "pricing-quote",
  message: "Слишком много запросов расчёта стоимости. Повторите попытку позднее",
});

const adminLoginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: "admin-login",
  keyGenerator: (req) => {
    const phone = String(req.body?.phone || "").replace(/\D/g, "").slice(0, 15);
    return phone || "missing-phone";
  },
  message: "Слишком много попыток входа. Повторите попытку позднее",
});

const adminLoginIpRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: "admin-login-ip",
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || "unknown",
  message: "Слишком много попыток входа с этого адреса. Повторите попытку позднее",
});

const authSessionRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyPrefix: "admin-session",
  message: "Слишком много запросов авторизации. Повторите попытку позднее",
});

const orderReadRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyPrefix: "order-read",
  message: "Слишком много запросов заказа. Повторите попытку позднее",
});

const orderMutationRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: "order-change",
  message: "Слишком много операций с заказом. Повторите попытку позднее",
});

const cdekOfficesRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyPrefix: "cdek-offices",
  message: "Слишком много запросов пунктов выдачи. Повторите попытку позднее",
});

const cdekCalculateRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyPrefix: "cdek-calculate",
  message: "Слишком много расчётов доставки. Повторите попытку позднее",
});

const paymentLinkRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "payment-link",
  message: "Слишком много запросов на оплату. Повторите попытку позднее",
});

const paymentCallbackRateLimit = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 300,
  keyPrefix: "payment-callback",
  message: "Too many payment callbacks",
});

module.exports = {
  adminUploadRateLimit,
  adminLoginRateLimit,
  adminLoginIpRateLimit,
  authSessionRateLimit,
  cdekCalculateRateLimit,
  cdekOfficesRateLimit,
  createRateLimiter,
  orderCreateRateLimit,
  orderMutationRateLimit,
  orderReadRateLimit,
  paymentCallbackRateLimit,
  paymentLinkRateLimit,
  pricingQuoteRateLimit,
};
