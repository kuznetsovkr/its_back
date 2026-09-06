const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const sharp = require("sharp");

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_ORDER_IMAGE_FILES = 10;
const MAX_IMAGE_PIXELS = 40_000_000;

const UPLOAD_ROOT = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads")
);
const TEMP_UPLOAD_DIR = path.join(UPLOAD_ROOT, ".tmp");
const INVENTORY_UPLOAD_DIR = path.join(UPLOAD_ROOT, "inventory");
const ORDER_UPLOAD_DIR = path.join(UPLOAD_ROOT, "orders");

const TYPE_BY_FORMAT = {
  jpeg: { extension: ".jpg", mime: "image/jpeg" },
  png: { extension: ".png", mime: "image/png" },
  webp: { extension: ".webp", mime: "image/webp" },
};

const ALLOWED_CLIENT_MIME_TYPES = new Set(Object.values(TYPE_BY_FORMAT).map(({ mime }) => mime));

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    fs.mkdir(TEMP_UPLOAD_DIR, { recursive: true }, (error) => {
      callback(error, TEMP_UPLOAD_DIR);
    });
  },
  filename: (_req, _file, callback) => {
    callback(null, `${crypto.randomUUID()}.upload`);
  },
});

const fileFilter = (_req, file, callback) => {
  if (!ALLOWED_CLIENT_MIME_TYPES.has(String(file.mimetype || "").toLowerCase())) {
    const error = new Error("Допустимы только изображения JPEG, PNG и WebP");
    error.code = "UNSUPPORTED_IMAGE_TYPE";
    return callback(error);
  }

  return callback(null, true);
};

const createImageUpload = (maxFiles) =>
  multer({
    storage: uploadStorage,
    fileFilter,
    limits: {
      fileSize: MAX_IMAGE_SIZE_BYTES,
      files: maxFiles,
      fields: 30,
      fieldSize: 32 * 1024,
      parts: maxFiles + 30,
    },
  });

const inventoryImageUpload = createImageUpload(1).single("image");
const orderImagesUpload = createImageUpload(MAX_ORDER_IMAGE_FILES).array(
  "images",
  MAX_ORDER_IMAGE_FILES
);

const detectImageTypeFromBuffer = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { format: "png", ...TYPE_BY_FORMAT.png };
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { format: "jpeg", ...TYPE_BY_FORMAT.jpeg };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { format: "webp", ...TYPE_BY_FORMAT.webp };
  }

  return null;
};

const detectImageTypeFromFile = async (filePath) => {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return detectImageTypeFromBuffer(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};

const validateImageFile = async (file) => {
  if (!file?.path) {
    throw new Error("Файл не найден во временном хранилище");
  }

  const detected = await detectImageTypeFromFile(file.path);
  if (!detected) {
    throw new Error("Содержимое файла не является JPEG, PNG или WebP");
  }

  const claimedMime = String(file.mimetype || "").toLowerCase();
  if (claimedMime && claimedMime !== detected.mime) {
    throw new Error("Формат файла не совпадает с заявленным MIME-типом");
  }

  let metadata;
  try {
    metadata = await sharp(file.path, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch (_error) {
    throw new Error("Изображение повреждено или имеет недопустимые размеры");
  }

  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
    !TYPE_BY_FORMAT[metadata.format]
  ) {
    throw new Error("Изображение имеет недопустимый формат или размеры");
  }

  if ((metadata.pages || 1) > 1) {
    throw new Error("Анимированные изображения не поддерживаются");
  }

  if (metadata.format !== detected.format) {
    throw new Error("Не удалось подтвердить формат изображения");
  }

  return {
    ...detected,
    width: metadata.width,
    height: metadata.height,
  };
};

const requestFiles = (req) => {
  if (Array.isArray(req?.files)) return req.files;
  if (req?.file) return [req.file];
  return [];
};

const removeTemporaryFiles = async (files) => {
  await Promise.all(
    (files || []).map(async (file) => {
      if (!file?.path) return;
      try {
        await fs.promises.unlink(file.path);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.warn(`[uploads] Failed to remove temporary file: ${error.message}`);
        }
      }
    })
  );
};

const clearTemporaryUploads = async () => {
  try {
    const entries = await fs.promises.readdir(TEMP_UPLOAD_DIR, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(".upload")) return;
        await fs.promises.unlink(path.join(TEMP_UPLOAD_DIR, entry.name));
      })
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

const validateUploadedImages = async (req, res, next) => {
  const files = requestFiles(req);

  try {
    for (const file of files) {
      file.validatedImage = await validateImageFile(file);
    }
    return next();
  } catch (error) {
    await removeTemporaryFiles(files);
    return res.status(415).json({ message: error.message || "Недопустимое изображение" });
  }
};

const cleanupTemporaryFilesAfterResponse = (req, res, next) => {
  const files = requestFiles(req);
  let cleanupStarted = false;
  const cleanup = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    removeTemporaryFiles(files).catch((error) => {
      console.warn(`[uploads] Temporary file cleanup failed: ${error.message}`);
    });
  };

  res.once("finish", cleanup);
  res.once("close", cleanup);
  next();
};

const isPathInside = (rootPath, candidatePath) => {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const persistValidatedImage = async (file, destinationDirectory) => {
  if (!file?.validatedImage) {
    throw new Error("Попытка сохранить непроверенное изображение");
  }

  const destination = path.resolve(destinationDirectory);
  if (!isPathInside(UPLOAD_ROOT, destination)) {
    throw new Error("Недопустимый каталог загрузки");
  }

  await fs.promises.mkdir(destination, { recursive: true });
  const fileName = `${crypto.randomUUID()}${file.validatedImage.extension}`;
  const finalPath = path.join(destination, fileName);
  await fs.promises.rename(file.path, finalPath);

  return {
    fileName,
    path: finalPath,
    mime: file.validatedImage.mime,
  };
};

const sanitizeOriginalName = (value, fallback = "image") => {
  const baseName = path.basename(String(value || fallback));
  const cleaned = Array.from(baseName.replace(/["\\/]/g, "_"))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? "_" : char;
    })
    .join("")
    .trim();
  return (cleaned || fallback).slice(0, 180);
};

const resolveSafeFilePath = (directory, fileName) => {
  const name = String(fileName || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return null;

  const root = path.resolve(directory);
  const candidate = path.resolve(root, name);
  return isPathInside(root, candidate) ? candidate : null;
};

const inspectStoredImage = async (filePath) => {
  const stat = await fs.promises.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > MAX_IMAGE_SIZE_BYTES) {
    const error = new Error("Stored image is unavailable");
    error.code = "INVALID_STORED_IMAGE";
    throw error;
  }

  const detected = await detectImageTypeFromFile(filePath);
  if (!detected) {
    const error = new Error("Stored image has an invalid type");
    error.code = "INVALID_STORED_IMAGE";
    throw error;
  }

  return { ...detected, size: stat.size };
};

const encodeContentDispositionName = (fileName) =>
  encodeURIComponent(fileName).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

const streamImage = ({ res, next, filePath, info, downloadName, isPublic = false }) => {
  const safeName = sanitizeOriginalName(downloadName, `image${info.extension}`);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  const disposition = `${isPublic ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeContentDispositionName(safeName)}`;

  res.set({
    "Cache-Control": isPublic ? "public, max-age=86400" : "private, no-store",
    "Content-Disposition": disposition,
    "Content-Length": String(info.size),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": info.mime,
    "Cross-Origin-Resource-Policy": "same-site",
    "X-Content-Type-Options": "nosniff",
  });

  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    if (res.headersSent) {
      return res.destroy(error);
    }
    return next(error);
  });
  stream.pipe(res);
};

const describeUploadError = (error) => {
  if (error?.code === "UNSUPPORTED_IMAGE_TYPE") {
    return { status: 415, message: error.message };
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return { status: 413, message: "Размер одного изображения не должен превышать 5 МБ" };
    }
    if (["LIMIT_FILE_COUNT", "LIMIT_PART_COUNT", "LIMIT_FIELD_COUNT"].includes(error.code)) {
      return { status: 413, message: "Превышено допустимое количество файлов или полей" };
    }
    if (error.code === "LIMIT_FIELD_VALUE") {
      return { status: 413, message: "Одно из полей формы слишком большое" };
    }
    return { status: 400, message: "Некорректный запрос загрузки" };
  }

  return null;
};

const uploadErrorHandler = async (error, req, res, next) => {
  const description = describeUploadError(error);
  if (!description) return next(error);

  await removeTemporaryFiles(requestFiles(req));
  return res.status(description.status).json({ message: description.message });
};

module.exports = {
  INVENTORY_UPLOAD_DIR,
  MAX_IMAGE_SIZE_BYTES,
  MAX_ORDER_IMAGE_FILES,
  ORDER_UPLOAD_DIR,
  UPLOAD_ROOT,
  clearTemporaryUploads,
  cleanupTemporaryFilesAfterResponse,
  detectImageTypeFromBuffer,
  inspectStoredImage,
  inventoryImageUpload,
  isPathInside,
  orderImagesUpload,
  persistValidatedImage,
  resolveSafeFilePath,
  sanitizeOriginalName,
  streamImage,
  uploadErrorHandler,
  validateImageFile,
  validateUploadedImages,
};
