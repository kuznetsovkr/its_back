const jwt = require("jsonwebtoken");
const User = require("../models/User");

const normalizePhone = (phone) => (phone ? phone.replace(/\D/g, "") : "");

const requireAdmin = async (req, res, next) => {
    const authHeader = req.header("Authorization");
    if (!authHeader) return res.status(401).json({ message: "Требуется авторизация" });

    try {
        const token = authHeader.replace("Bearer ", "").trim();
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Admin token issued directly or contains admin phone in payload
        if (decoded.role === "admin") {
            req.user = decoded;
            return next();
        }

        if (decoded.phone && process.env.ADMIN_PHONE) {
            const fromToken = normalizePhone(decoded.phone);
            const adminPhone = normalizePhone(process.env.ADMIN_PHONE);
            if (fromToken && adminPhone && fromToken === adminPhone) {
                req.user = { ...decoded, role: "admin" };
                return next();
            }
        }

        if (decoded.id) {
            const user = await User.findByPk(decoded.id);
            if (user && user.role === "admin") {
                req.user = { id: user.id, role: user.role, phone: user.phone };
                return next();
            }
        }

        return res.status(403).json({ message: "Требуются права администратора" });
    } catch (error) {
        console.error("[AUTH] admin check failed:", error);
        return res.status(401).json({ message: "Невалидный токен" });
    }
};

module.exports = requireAdmin;
