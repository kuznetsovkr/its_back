const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Отправляет заказ в Telegram (текст + изображения)
 * @param {Object} order - Данные заказа
 */
const sendOrderToTelegram = async (order) => {
    console.log("📦 Данные перед отправкой в Telegram:", order);

    try {
        const message =
            `📦 *Новый заказ!*\n\n` +
            `📅 Дата: ${new Date(order.orderDate).toLocaleString("ru-RU")}\n` +
            `📞 Телефон: ${order.phone}\n` +
            `👤 Получатель: ${order.fullName || "Не указано"}\n` +
            `🛍️ Изделие: ${order.productType || "Не указано"}, ${order.color || "Не указано"}, ${order.size || "Не указано"}\n` +
            `🎨 Вышивка: ${order.embroideryType || "Не указано"}\n` +
            `🔤 Текст: ${order.customText || "-"}\n` +
            `💬 Комментарий: ${order.comment || "Нет комментария"}\n`+
            `📍 Адрес доставки: ${order.deliveryAddress || "Не указан"}\n`+
            `💰 Стоимость заказа: ${order.totalPrice || "Не указана"}\n`;

        // Отправляем текстовое сообщение
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: "Markdown",
        });

        // Если есть изображения — отправим их
        if (order.images && Array.isArray(order.images)) {
            for (const image of order.images) {
                try {
                    const form = new FormData();
                    form.append("chat_id", CHAT_ID);
                    form.append("photo", fs.createReadStream(image.path));

                    await axios.post(
                        `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
                        form,
                        { headers: form.getHeaders() }
                    );

                    // Удалим временный файл
                    fs.unlink(image.path, (err) => {
                        if (err) {
                            console.warn("⚠️ Не удалось удалить временный файл:", image.path);
                        } else {
                            console.log("🧹 Временный файл удалён:", image.path);
                        }
                    });
                } catch (photoError) {
                    console.error("❌ Ошибка при отправке фото в Telegram:", photoError.response?.data || photoError.message);
                }
            }
        }
    } catch (error) {
        console.error("❌ Ошибка отправки сообщения в Telegram:", error.response?.data || error.message);
    }
};

module.exports = sendOrderToTelegram;
