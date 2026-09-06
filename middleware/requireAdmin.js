const jwt = require("jsonwebtoken");

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "");

const requireAdmin = (req, res, next) => {
    const jwtSecret = process.env.JWT_SECRET;
    const adminPhone = normalizePhone(process.env.ADMIN_PHONE);
    if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32 || !/^\d{10,11}$/.test(adminPhone)) {
        return res.status(503).json({ message: "Авторизация администратора не настроена" });
    }
    const authHeader = req.header("Authorization");
    if (!authHeader) return res.status(401).json({ message: "Требуется авторизация" });
    if (authHeader.length > 4096) {
        return res.status(401).json({ message: "Некорректный формат авторизации" });
    }

    try {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            return res.status(401).json({ message: "Некорректный формат авторизации" });
        }
        const decoded = jwt.verify(match[1], jwtSecret, { algorithms: ["HS256"] });

        const tokenPhone = normalizePhone(decoded.phone);
        const hasAdminRole = decoded.role === "admin";
        const matchesConfiguredPhone = tokenPhone === adminPhone;

        if (hasAdminRole && matchesConfiguredPhone) {
            req.user = decoded;
            return next();
        }

        return res.status(403).json({ message: "Требуются права администратора" });
    } catch (error) {
        if (error.name !== "JsonWebTokenError" && error.name !== "TokenExpiredError") {
            console.error("[AUTH] admin check failed:", error.message);
        }
        return res.status(401).json({ message: "Невалидный токен" });
    }
};

module.exports = requireAdmin;
