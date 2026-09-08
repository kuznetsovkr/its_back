const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const {
  createCorsMiddleware,
  getAllowedOrigins,
  handleCorsError,
} = require("../middleware/corsPolicy");

const createTestServer = async (t, env) => {
  const app = express();
  app.use(createCorsMiddleware(env));
  app.use(handleCorsError);
  app.get("/resource", (_req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/resource`;
};

test("production CORS allows configured origins and server-to-server requests", async (t) => {
  const url = await createTestServer(t, {
    NODE_ENV: "production",
    PUBLIC_APP_URL: "https://shop.example",
    ALLOWED_PUBLIC_ORIGINS: "https://www.shop.example, https://admin.shop.example",
  });

  const sameOriginResponse = await fetch(url, {
    headers: { Origin: "https://shop.example" },
  });
  assert.equal(sameOriginResponse.status, 200);
  assert.equal(
    sameOriginResponse.headers.get("access-control-allow-origin"),
    "https://shop.example"
  );
  assert.match(sameOriginResponse.headers.get("vary"), /Origin/i);

  const additionalOriginResponse = await fetch(url, {
    headers: { Origin: "https://admin.shop.example" },
  });
  assert.equal(additionalOriginResponse.status, 200);
  assert.equal(
    additionalOriginResponse.headers.get("access-control-allow-origin"),
    "https://admin.shop.example"
  );

  const serverRequest = await fetch(url);
  assert.equal(serverRequest.status, 200);
  assert.equal(serverRequest.headers.get("access-control-allow-origin"), null);
});

test("production CORS rejects an unknown browser origin", async (t) => {
  const url = await createTestServer(t, {
    NODE_ENV: "production",
    ALLOWED_PUBLIC_ORIGINS: "https://shop.example",
  });

  const response = await fetch(url, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), { message: "Источник запроса не разрешён" });
});

test("CORS handles allowed and denied preflight requests", async (t) => {
  const url = await createTestServer(t, {
    NODE_ENV: "production",
    ALLOWED_PUBLIC_ORIGINS: "https://shop.example",
  });

  const allowed = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "https://shop.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,x-order-access-token",
    },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://shop.example");
  assert.match(allowed.headers.get("access-control-allow-methods"), /POST/);
  assert.match(allowed.headers.get("access-control-allow-headers"), /Authorization/i);
  assert.equal(allowed.headers.get("access-control-max-age"), "600");

  const denied = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("CORS configuration fails closed in production", () => {
  assert.throws(
    () => getAllowedOrigins({ NODE_ENV: "production" }),
    /CORS allowlist is empty/
  );
  assert.throws(
    () =>
      getAllowedOrigins({
        NODE_ENV: "production",
        ALLOWED_PUBLIC_ORIGINS: "https://*.example.com",
      }),
    /Invalid CORS origin configuration/
  );
  assert.throws(
    () =>
      getAllowedOrigins({
        NODE_ENV: "production",
        PUBLIC_APP_URL: "https://shop.example/api",
      }),
    /Invalid CORS origin configuration/
  );
});

test("development CORS includes loopback frontend origins", () => {
  const origins = getAllowedOrigins({ NODE_ENV: "development" });
  assert.equal(origins.has("http://localhost:3000"), true);
  assert.equal(origins.has("http://127.0.0.1:3000"), true);
});
