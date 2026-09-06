const jwt = require("jsonwebtoken");

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "");

const requireAdmin = (req, res, next) => {
    const authHeader = req.header("Authorization");
    if (!authHeader) return res.status(401).json({ message: "Требуется авторизация" });

    try {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            return res.status(401).json({ message: "Некорректный формат авторизации" });
        }
        const decoded = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ["HS256"] });

        const adminPhone = normalizePhone(process.env.ADMIN_PHONE);
        const tokenPhone = normalizePhone(decoded.phone);
        const hasAdminRole = decoded.role === "admin";
        const matchesConfiguredPhone = !adminPhone || tokenPhone === adminPhone;

        if (hasAdminRole && matchesConfiguredPhone) {
            req.user = decoded;
            return next();
        }

        return res.status(403).json({ message: "Требуются права администратора" });
    } catch (error) {
        console.error("[AUTH] admin check failed:", error);
        return res.status(401).json({ message: "Невалидный токен" });
    }
};

module.exports = requireAdmin;
