const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization");
  if (!token) return res.status(401).json({ message: "Нет доступа" });

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
    req.user = decoded; // Добавляем в `req` данные пользователя
    next();
  } catch (error) {
    res.status(401).json({ message: "Неверный токен" });
  }
};

module.exports = authMiddleware;
