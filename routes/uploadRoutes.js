const express = require('express');
const multer  = require('multer');
const path    = require('path');

const router = express.Router();

// используем тот же каталог, что и в index.js
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// POST /api/upload  (поле: image)
router.post('/', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });

  // сразу отдаём удобный URL (новый путь под /api)
  res.status(201).json({
    imageUrl: `/api/uploads/${req.file.filename}`,
    filename: req.file.filename,
    ok: true,
  });
});

module.exports = router;
