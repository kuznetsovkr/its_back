const axios = require("axios");
require("dotenv").config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Отправляет заказ в Telegram
 * @param {Object} order - Данные заказа
 */
const sendOrderToTelegram = async (order) => {
    console.log("📦 Данные перед отправкой в Telegram:", order); // ✅ Проверяем, что передаётся

    try {
        const message = `📦 *Новый заказ!*\n\n` +
            `📅 Дата: ${order.orderDate}\n` +
            `📞 Телефон: ${order.phone}\n` +
            `👤 Получатель: ${order.fullName || "Не указано"}\n` + // Добавим проверку на undefined
            `🛍️ Изделие: ${order.productType || "Не указано"}, ${order.color || "Не указано"}, ${order.size || "Не указано"}\n` +
            `🎨 Вышивка: ${order.embroideryType || "Не указано"}\n` +
            `💬 Комментарий: ${order.comment || "Нет комментария"}\n`;

        console.log("📨 Отправка заказа в Telegram...", message);

        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: "Markdown",
        });

        console.log("✅ Заказ успешно отправлен в Telegram", response.data);
    } catch (error) {
        console.error("❌ Ошибка отправки в Telegram:", error.response?.data || error.message);
    }
};


module.exports = sendOrderToTelegram;
