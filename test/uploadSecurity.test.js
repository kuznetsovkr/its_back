const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const testUploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "its-upload-root-"));
process.env.UPLOAD_DIR = testUploadRoot;
process.env.JWT_SECRET = "test-only-jwt-secret-that-is-long-enough";
process.env.ORDER_ACCESS_SECRET = "test-only-order-secret-that-is-long-enough";
process.env.ADMIN_PHONE = "79990000000";
process.env.ADMIN_PASSWORD = "test-only-admin-password";

const {
  detectImageTypeFromBuffer,
  resolveSafeFilePath,
  sanitizeOriginalName,
  validateImageFile,
} = require("../lib/uploadSecurity");

after(() => fs.promises.rm(testUploadRoot, { recursive: true, force: true }));

test("detects supported image signatures and rejects text", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");

  assert.equal(detectImageTypeFromBuffer(png)?.format, "png");
  assert.equal(detectImageTypeFromBuffer(jpeg)?.format, "jpeg");
  assert.equal(detectImageTypeFromBuffer(webp)?.format, "webp");
  assert.equal(detectImageTypeFromBuffer(Buffer.from("<svg></svg>")), null);
});

test("allows only a single safe file-name segment", () => {
  const root = path.join(os.tmpdir(), "its-public-images");

  assert.equal(resolveSafeFilePath(root, "photo-123.webp"), path.join(root, "photo-123.webp"));
  assert.equal(resolveSafeFilePath(root, "../secret.png"), null);
  assert.equal(resolveSafeFilePath(root, ".env"), null);
  assert.equal(resolveSafeFilePath(root, "folder/photo.png"), null);
});

test("rate limiter blocks repeated requests by the client address", async (t) => {
  const express = require("express");
  const { createRateLimiter } = require("../middleware/rateLimit");
  const app = express();
  app.get(
    "/limited",
    createRateLimiter({ windowMs: 60_000, max: 2, keyPrefix: "test", message: "Limited" }),
    (_req, res) => res.json({ ok: true })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/limited`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url)).status, 200);
  const blocked = await fetch(url);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
});

test("production order requests require the configured browser origin", async (t) => {
  const express = require("express");
  const requireTrustedOrigin = require("../middleware/trustedOrigin");
  const previousNodeEnv = process.env.NODE_ENV;
  const previousOrigins = process.env.ALLOWED_PUBLIC_ORIGINS;
  process.env.NODE_ENV = "production";
  process.env.ALLOWED_PUBLIC_ORIGINS = "https://shop.example";
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousOrigins === undefined) delete process.env.ALLOWED_PUBLIC_ORIGINS;
    else process.env.ALLOWED_PUBLIC_ORIGINS = previousOrigins;
  });

  const app = express();
  app.post("/order", requireTrustedOrigin, (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/order`;
  assert.equal((await fetch(url, { method: "POST" })).status, 403);
  assert.equal(
    (await fetch(url, { method: "POST", headers: { Origin: "https://evil.example" } })).status,
    403
  );
  assert.equal(
    (await fetch(url, { method: "POST", headers: { Origin: "https://shop.example" } })).status,
    200
  );
});

test("sanitizes an original file name before storing it as metadata", () => {
  assert.equal(sanitizeOriginalName("../pet\u0000photo.jpg"), "pet_photo.jpg");
  assert.equal(sanitizeOriginalName("\"photo\".png"), "_photo_.png");
});

test("validates a decodable PNG and rejects a disguised text file", async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "its-upload-test-"));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

  const pngPath = path.join(directory, "valid.upload");
  const textPath = path.join(directory, "fake.upload");
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  await fs.promises.writeFile(pngPath, onePixelPng);
  await fs.promises.writeFile(textPath, "<html><script>alert(1)</script></html>");

  const result = await validateImageFile({ path: pngPath, mimetype: "image/png" });
  assert.equal(result.format, "png");
  assert.equal(result.mime, "image/png");
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);

  await assert.rejects(
    validateImageFile({ path: textPath, mimetype: "image/png" }),
    /Содержимое файла/
  );
});

test("admin upload is protected, validated and served only through the image controller", async (t) => {
  const express = require("express");
  const jwt = require("jsonwebtoken");
  const fileRoutes = require("../routes/fileRoutes");
  const uploadRoutes = require("../routes/uploadRoutes");

  const app = express();
  app.use("/api/upload", uploadRoutes);
  app.use("/api/uploads", fileRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminToken = jwt.sign(
    { role: "admin", phone: process.env.ADMIN_PHONE },
    process.env.JWT_SECRET
  );
  const userToken = jwt.sign(
    { role: "user", phone: process.env.ADMIN_PHONE },
    process.env.JWT_SECRET
  );
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  const makeForm = (content, type, name) => {
    const form = new FormData();
    form.append("image", new Blob([content], { type }), name);
    return form;
  };

  const anonymousResponse = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    body: makeForm(onePixelPng, "image/png", "pet.png"),
  });
  assert.equal(anonymousResponse.status, 401);

  const userResponse = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
    body: makeForm(onePixelPng, "image/png", "pet.png"),
  });
  assert.equal(userResponse.status, 403);

  const disguisedResponse = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: makeForm("<html><script>alert(1)</script></html>", "image/png", "pet.png"),
  });
  assert.equal(disguisedResponse.status, 415);

  const oversizedResponse = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: makeForm(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png", "large.png"),
  });
  assert.equal(oversizedResponse.status, 413);

  const uploadResponse = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: makeForm(onePixelPng, "image/png", "pet.png"),
  });
  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.match(uploaded.imageUrl, /^\/api\/uploads\/inventory\/[a-f0-9-]+\.png$/);

  const imageResponse = await fetch(`${baseUrl}${uploaded.imageUrl}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), onePixelPng);

  await fs.promises.writeFile(path.join(testUploadRoot, "legacy.png"), onePixelPng);
  const legacyResponse = await fetch(`${baseUrl}/api/uploads/legacy.png`);
  assert.equal(legacyResponse.status, 200);
  assert.equal(legacyResponse.headers.get("content-type"), "image/png");

  await fs.promises.writeFile(path.join(testUploadRoot, "private-without-extension"), onePixelPng);
  const extensionlessResponse = await fetch(
    `${baseUrl}/api/uploads/private-without-extension`
  );
  assert.equal(extensionlessResponse.status, 404);

  const privatePathResponse = await fetch(`${baseUrl}/api/uploads/orders/1/secret.png`);
  assert.equal(privatePathResponse.status, 404);

  const temporaryFiles = fs.existsSync(path.join(testUploadRoot, ".tmp"))
    ? await fs.promises.readdir(path.join(testUploadRoot, ".tmp"))
    : [];
  assert.deepEqual(temporaryFiles, []);
});

test("guest order token grants access to one order without user authentication", async (t) => {
  const express = require("express");
  const jwt = require("jsonwebtoken");
  const {
    canAccessOrder,
    createOrderAccessToken,
    requireOrderAccess,
  } = require("../middleware/orderAccess");
  const app = express();
  app.get("/orders/:orderId", requireOrderAccess, (req, res) => {
    if (!canAccessOrder(req, Number(req.params.orderId))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return res.json({ ok: true });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const orderToken = createOrderAccessToken(42);

  assert.equal((await fetch(`${baseUrl}/orders/42`)).status, 401);

  const allowedResponse = await fetch(`${baseUrl}/orders/42`, {
    headers: { "X-Order-Access-Token": orderToken },
  });
  assert.equal(allowedResponse.status, 200);

  const otherOrderResponse = await fetch(`${baseUrl}/orders/43`, {
    headers: { "X-Order-Access-Token": orderToken },
  });
  assert.equal(otherOrderResponse.status, 403);

  const adminToken = jwt.sign(
    { role: "admin", phone: process.env.ADMIN_PHONE },
    process.env.JWT_SECRET
  );
  const adminResponse = await fetch(`${baseUrl}/orders/43`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminResponse.status, 200);
});

test("public order creation validates phone and privacy consent before database access", async (t) => {
  const express = require("express");
  const orderRoutes = require("../routes/orderRoutes");
  const app = express();
  app.use("/api/orders", orderRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/orders/create`;

  const invalidPhone = new FormData();
  invalidPhone.append("firstName", "Test");
  invalidPhone.append("lastName", "User");
  invalidPhone.append("phone", "123");
  invalidPhone.append("privacyConsent", "true");
  assert.equal((await fetch(url, { method: "POST", body: invalidPhone })).status, 400);

  const missingConsent = new FormData();
  missingConsent.append("firstName", "Test");
  missingConsent.append("lastName", "User");
  missingConsent.append("phone", "+7 999 000-00-01");
  missingConsent.append("privacyConsent", "false");
  assert.equal((await fetch(url, { method: "POST", body: missingConsent })).status, 400);
});

test("SMS and user login endpoints are removed while admin JWT login remains", async (t) => {
  const express = require("express");
  const authRoutes = require("../routes/authRoutes");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/request-sms`, { method: "POST" })).status,
    404
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/login`, { method: "POST" })).status,
    404
  );

  const loginResponse = await fetch(`${baseUrl}/api/auth/admin-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: process.env.ADMIN_PHONE,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  assert.equal(loginResponse.status, 200);
  const { token, role } = await loginResponse.json();
  assert.equal(role, "admin");

  const sessionResponse = await fetch(`${baseUrl}/api/auth/admin-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(sessionResponse.status, 200);
});
