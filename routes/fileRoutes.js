const express = require("express");
const {
  INVENTORY_UPLOAD_DIR,
  UPLOAD_ROOT,
  inspectStoredImage,
  resolveSafeFilePath,
  streamImage,
} = require("../lib/uploadSecurity");

const router = express.Router();
const PUBLIC_IMAGE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:jpe?g|png|webp)$/i;

const servePublicInventoryImage = (directory) => async (req, res, next) => {
  if (!PUBLIC_IMAGE_FILE_NAME.test(String(req.params.filename || ""))) {
    return res.status(404).json({ message: "Изображение не найдено" });
  }

  const filePath = resolveSafeFilePath(directory, req.params.filename);
  if (!filePath) {
    return res.status(404).json({ message: "Изображение не найдено" });
  }

  try {
    const info = await inspectStoredImage(filePath);
    return streamImage({
      res,
      next,
      filePath,
      info,
      downloadName: req.params.filename,
      isPublic: true,
    });
  } catch (error) {
    if (["ENOENT", "INVALID_STORED_IMAGE"].includes(error.code)) {
      return res.status(404).json({ message: "Изображение не найдено" });
    }
    return next(error);
  }
};

// New inventory uploads are isolated from private order attachments.
router.get("/inventory/:filename", servePublicInventoryImage(INVENTORY_UPLOAD_DIR));

// Compatibility for existing inventory records that point to /api/uploads/:filename.
// Only one safe path segment and a verified image signature are accepted.
router.get("/:filename", servePublicInventoryImage(UPLOAD_ROOT));

module.exports = router;
