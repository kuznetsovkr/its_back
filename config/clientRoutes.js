const CLIENT_APP_ROUTES = new Set([
  "/",
  "/certificate",
  "/order",
  "/embroidery",
  "/recipient",
  "/thank-you",
  "/payment-success",
  "/payment-fail",
  "/admin",
  "/admin/inventory",
]);

const normalizeClientPath = (value) => {
  const path = String(value || "/");
  if (path === "/") return path;
  return path.replace(/\/+$/, "") || "/";
};

const isClientAppRoute = (path) => CLIENT_APP_ROUTES.has(normalizeClientPath(path));

module.exports = {
  CLIENT_APP_ROUTES,
  isClientAppRoute,
  normalizeClientPath,
};
