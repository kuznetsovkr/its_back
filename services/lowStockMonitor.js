const { Op } = require("sequelize");
const Inventory = require("../models/Inventory");
const LowStockAlert = require("../models/LowStockAlert");
const { sendLowStockAlert } = require("./telegramLowStock");

const THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 10);

/**
 * Пометить позицию как "уведомление отправлено"
 */
async function markNotified(inventoryId) {
  await LowStockAlert.upsert({
    inventoryId,
    threshold: THRESHOLD,
    notifiedAt: new Date(),
    clearedAt: null,
  });
}

/**
 * Сбросить пометку (когда остаток снова >= THRESHOLD)
 */
async function clearIfRecovered(inventoryId) {
  const rec = await LowStockAlert.findOne({ where: { inventoryId } });
  if (rec && !rec.clearedAt) {
    rec.clearedAt = new Date();
    await rec.save();
  }
}

/**
 * Проверить конкретную позицию и при необходимости прислать уведомление.
 * Вызывать сразу после успешного уменьшения количества по заказу.
 */
async function checkItemAndNotify(inventoryId) {
  const item = await Inventory.findByPk(inventoryId);
  if (!item) return;

  if (item.quantity < THRESHOLD) {
    // Не слать повторно, если уже слали и не было "восстановления"
    const already = await LowStockAlert.findOne({ where: { inventoryId, clearedAt: { [Op.is]: null } } });
    if (!already) {
      await sendLowStockAlert([{
        productType: item.productType,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
      }], THRESHOLD);
      await markNotified(inventoryId);
    }
  } else {
    // Если восстановили остаток — очищаем флаг
    await clearIfRecovered(inventoryId);
  }
}

/**
 * Периодическая проверка всего склада (safety net).
 * Можно повесить на cron раз в N минут/час.
 */
async function checkAllAndNotify() {
  // Находим все, у кого остаток ниже порога
  const lowItems = await Inventory.findAll({
    where: { quantity: { [Op.lt]: THRESHOLD } },
  });

  if (!lowItems.length) return;

  // Отфильтровать те, по которым уже слали и не было восстановления
  const alerts = await LowStockAlert.findAll({ where: { clearedAt: { [Op.is]: null } } });
  const alertedIds = new Set(alerts.map(a => a.inventoryId));

  const fresh = lowItems.filter(i => !alertedIds.has(i.id));

  if (fresh.length) {
    await sendLowStockAlert(
      fresh.map(i => ({
        productType: i.productType,
        color: i.color,
        size: i.size,
        quantity: i.quantity,
      })), THRESHOLD
    );
    // Помечаем как отправленные
    await Promise.all(fresh.map(i => markNotified(i.id)));
  }

  // И наоборот: у кого восстановился остаток — снимаем флаг
  const recovered = await Inventory.findAll({
    where: { quantity: { [Op.gte]: THRESHOLD } },
    attributes: ["id"],
  });
  const recoveredIds = new Set(recovered.map(r => r.id));
  const toClear = alerts.filter(a => recoveredIds.has(a.inventoryId));
  await Promise.all(toClear.map(a => { a.clearedAt = new Date(); return a.save(); }));
}

module.exports = {
  checkItemAndNotify,
  checkAllAndNotify,
};
