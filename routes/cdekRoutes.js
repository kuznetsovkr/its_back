const express = require("express");
const axios = require("axios");
require("dotenv").config();

const router = express.Router();

// ✅ Получение токена CDEK
const getCdekToken = async () => {
    try {
        const response = await axios.post("https://api.edu.cdek.ru/v2/oauth/token?grant_type=client_credentials", {
            client_id: process.env.CDEK_CLIENT_ID,
            client_secret: process.env.CDEK_CLIENT_SECRET,
        }, { headers: { "Content-Type": "application/json" } });

        return response.data.access_token;
    } catch (error) {
        console.error("Ошибка получения токена CDEK:", error.response?.data || error.message);
        return null;
    }
};

// ✅ Получение списка пунктов выдачи
router.get("/pickup-points", async (req, res) => {
    try {
        const token = await getCdekToken();
        if (!token) return res.status(500).json({ message: "Ошибка получения токена CDEK" });

        const response = await axios.get("https://api.edu.cdek.ru/v2/deliverypoints", {
            headers: { Authorization: `Bearer ${token}` },
        });

        res.json(response.data);
    } catch (error) {
        console.error("Ошибка загрузки ПВЗ CDEK:", error.response?.data || error.message);
        res.status(500).json({ message: "Ошибка загрузки пунктов выдачи" });
    }
});

module.exports = router;
