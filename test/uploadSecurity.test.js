const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const testUploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "its-upload-root-"));
process.env.UPLOAD_DIR = testUploadRoot;
process.env.JWT_SECRET = "test-only-jwt-secret-that-is-long-enough";
process.env.ADMIN_PHONE = "79990000000";

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

test("rate limiter blocks repeated requests by the authenticated identity", async (t) => {
  const express = require("express");
  const { createRateLimiter } = require("../middleware/rateLimit");
  const app = express();
  app.use((req, _res, next) => {
    req.user = { role: "user", phone: "79990000001" };
    next();
  });
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

test("order attachments require authentication and the token phone must own the order", async (t) => {
  const express = require("express");
  const jwt = require("jsonwebtoken");
  const orderRoutes = require("../routes/orderRoutes");
  const app = express();
  app.use("/api/orders", orderRoutes);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/api/orders/create`;
  const token = jwt.sign(
    { role: "user", phone: "79990000001" },
    process.env.JWT_SECRET
  );
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const makeOrderForm = () => {
    const form = new FormData();
    form.append("firstName", "Test");
    form.append("lastName", "User");
    form.append("phone", "+7 999 000-00-02");
    form.append("images", new Blob([onePixelPng], { type: "image/png" }), "pet.png");
    return form;
  };

  const anonymousResponse = await fetch(url, { method: "POST", body: makeOrderForm() });
  assert.equal(anonymousResponse.status, 401);

  const wrongOwnerResponse = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: makeOrderForm(),
  });
  assert.equal(wrongOwnerResponse.status, 403);
});
