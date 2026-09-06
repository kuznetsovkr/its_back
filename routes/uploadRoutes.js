const express = require("express");
const requireAdmin = require("../middleware/requireAdmin");
const { adminUploadRateLimit } = require("../middleware/rateLimit");
const {
  INVENTORY_UPLOAD_DIR,
  cleanupTemporaryFilesAfterResponse,
  inventoryImageUpload,
  persistValidatedImage,
  uploadErrorHandler,
  validateUploadedImages,
} = require("../lib/uploadSecurity");

const router = express.Router();

router.post(
  "/",
  requireAdmin,
  adminUploadRateLimit,
  inventoryImageUpload,
  validateUploadedImages,
  cleanupTemporaryFilesAfterResponse,
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ message: "Файл не загружен" });
    }

    try {
      const stored = await persistValidatedImage(req.file, INVENTORY_UPLOAD_DIR);
      return res.status(201).json({
        imageUrl: `/api/uploads/inventory/${stored.fileName}`,
        filename: stored.fileName,
        ok: true,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.use(uploadErrorHandler);

module.exports = router;
