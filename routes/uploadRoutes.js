const express = require("express");
const multer = require("multer");
const path = require("path");

const router = express.Router();

// 🗂 Конфигурация хранилища Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/"); // Файлы сохраняются в папке uploads/
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Уникальное имя файла
    },
});

const upload = multer({ storage });

// 🔹 Загрузка изображения (POST /api/upload)
router.post("/", upload.single("image"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "Файл не загружен" });
    }

    res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

module.exports = router;
