const apiNotFound = (_req, res) =>
  res.status(404).json({
    message: "Маршрут API не найден",
    code: "api_route_not_found",
  });

module.exports = { apiNotFound };
