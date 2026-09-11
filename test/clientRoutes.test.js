const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CLIENT_APP_ROUTES,
  isClientAppRoute,
  normalizeClientPath,
} = require("../config/clientRoutes");

test("client route allowlist contains every public SPA entry point", () => {
  for (const path of [
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
  ]) {
    assert.equal(isClientAppRoute(path), true, path);
    assert.equal(isClientAppRoute(`${path === "/" ? "" : path}/`), true, `${path}/`);
  }
});

test("retired payment simulators and unknown URLs are HTTP 404 candidates", () => {
  assert.equal(CLIENT_APP_ROUTES.has("/payment"), false);
  assert.equal(CLIENT_APP_ROUTES.has("/fake-payment"), false);
  assert.equal(isClientAppRoute("/payment"), false);
  assert.equal(isClientAppRoute("/fake-payment"), false);
  assert.equal(isClientAppRoute("/does-not-exist"), false);
  assert.equal(isClientAppRoute("/order/unexpected"), false);
});

test("client paths are normalized without widening the allowlist", () => {
  assert.equal(normalizeClientPath("/order///"), "/order");
  assert.equal(normalizeClientPath(""), "/");
});
