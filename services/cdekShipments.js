const axios = require("axios");
const { Op } = require("sequelize");
const sequelize = require("../db");
const Order = require("../models/Order");
const Inventory = require("../models/Inventory");
const OrderShipment = require("../models/OrderShipment");
const { getCdekRequestContext } = require("./cdekClient");
const { getCdekFromLocation, getGoodsPreset } = require("./orderPricing");
const { sendOrderIssueToTelegram } = require("../telegram");

const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

const markCdekShipmentReady = async (orderId, transaction) => {
  const shipment = await OrderShipment.findOne({
    where: { orderId, provider: "cdek" },
    transaction,
    lock: transaction?.LOCK.UPDATE,
  });
  if (!shipment || shipment.status === "created") return shipment;
  shipment.status = "ready";
  shipment.lastError = null;
  await shipment.save({ transaction });
  return shipment;
};

const claimShipment = async (orderId) =>
  sequelize.transaction(async (transaction) => {
    const shipment = await OrderShipment.findOne({
      where: { orderId, provider: "cdek" },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!shipment) return { skip: "not_configured" };
    if (shipment.status === "created") return { skip: "already_created", shipment };

    const processingStartedAt = new Date(shipment.processingStartedAt || 0).getTime();
    if (shipment.status === "processing" && processingStartedAt > Date.now() - PROCESSING_TIMEOUT_MS) {
      return { skip: "in_progress", shipment };
    }

    const order = await Order.findByPk(orderId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order || order.paymentStatus !== "paid") return { skip: "not_paid", shipment };

    const inventory = await Inventory.findByPk(order.inventoryId, { transaction });
    if (!inventory) throw new Error("Inventory for CDEK shipment not found");

    shipment.status = "processing";
    shipment.processingStartedAt = new Date();
    shipment.attempts = Number(shipment.attempts || 0) + 1;
    shipment.lastError = null;
    await shipment.save({ transaction });

    return {
      order: order.get({ plain: true }),
      inventory: inventory.get({ plain: true }),
      shipment: shipment.get({ plain: true }),
    };
  });

const buildCdekOrderPayload = ({ order, inventory, shipment }) => {
  const parcel = getGoodsPreset(inventory);
  return {
    type: 1,
    number: String(order.id),
    tariff_code: shipment.tariffCode,
    from_location: getCdekFromLocation(),
    delivery_point: shipment.deliveryPoint,
    recipient: {
      name: shipment.recipientName,
      phones: [{ number: shipment.recipientPhone }],
    },
    packages: [{
      ...parcel,
      number: `order-${order.id}-1`,
      items: [{
        name: order.productType,
        ware_key: `ORDER-${order.id}`,
        cost: shipment.declaredValue,
        payment: { value: 0 },
        weight: parcel.weight,
        amount: 1,
      }],
    }],
    delivery_recipient_cost: { value: 0 },
    recipient_currency: "RUB",
  };
};

const extractCdekErrors = (data) => {
  const errors = [];
  for (const request of Array.isArray(data?.requests) ? data.requests : []) {
    for (const error of Array.isArray(request?.errors) ? request.errors : []) {
      if (error?.message) errors.push(error.message);
    }
  }
  return errors;
};

const createCdekShipmentForOrder = async (orderId) => {
  const claimed = await claimShipment(orderId);
  if (claimed.skip) return { ok: true, skipped: claimed.skip, shipment: claimed.shipment || null };

  try {
    const payload = buildCdekOrderPayload(claimed);
    const { baseUrl, headers } = await getCdekRequestContext();
    const response = await axios.post(`${baseUrl}/orders`, payload, {
      headers,
      timeout: 15_000,
    });
    const errors = extractCdekErrors(response.data);
    const entity = response.data?.entity || {};
    if (errors.length || (!entity.uuid && !entity.cdek_number)) {
      throw new Error(errors.join("; ") || "CDEK did not accept the shipment");
    }

    const shipment = await OrderShipment.findOne({ where: { orderId, provider: "cdek" } });
    if (shipment) {
      shipment.status = "created";
      shipment.providerUuid = entity.uuid || shipment.providerUuid;
      shipment.cdekNumber = entity.cdek_number || shipment.cdekNumber;
      shipment.createdAtProvider = new Date();
      shipment.processingStartedAt = null;
      shipment.lastError = null;
      await shipment.save();
    }
    return { ok: true, shipment, response: response.data };
  } catch (error) {
    const errorMessage = String(
      error.response?.data?.message || error.message || error
    ).slice(0, 4000);
    await OrderShipment.update({
      status: "failed",
      processingStartedAt: null,
      lastError: errorMessage,
    }, { where: { orderId, provider: "cdek", status: "processing" } });
    if (Number(claimed.shipment.attempts) === 1) {
      try {
        await sendOrderIssueToTelegram(
          claimed.order,
          `Не удалось создать отправление СДЭК: ${errorMessage.slice(0, 500)}`
        );
      } catch (notificationError) {
        console.error("CDEK issue notification failed:", notificationError.message);
      }
    }
    throw error;
  }
};

const refreshCdekShipment = async (orderId) => {
  const shipment = await OrderShipment.findOne({ where: { orderId, provider: "cdek" } });
  if (!shipment || shipment.status !== "created" || shipment.cdekNumber || !shipment.providerUuid) {
    return shipment;
  }

  const { baseUrl, headers } = await getCdekRequestContext();
  const response = await axios.get(
    `${baseUrl}/orders/${encodeURIComponent(shipment.providerUuid)}`,
    { headers, timeout: 15_000 }
  );
  const cdekNumber = response.data?.entity?.cdek_number || response.data?.cdek_number || null;
  if (cdekNumber) {
    shipment.cdekNumber = String(cdekNumber).slice(0, 64);
    shipment.lastError = null;
    await shipment.save();
  }
  return shipment;
};

const retryPendingCdekShipments = async ({ limit = 20 } = {}) => {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  const shipments = await OrderShipment.findAll({
    where: {
      [Op.or]: [
        { status: { [Op.in]: ["ready", "failed"] } },
        { status: "processing", processingStartedAt: { [Op.lte]: staleBefore } },
        { status: "created", cdekNumber: { [Op.is]: null } },
      ],
    },
    attributes: ["orderId", "status"],
    order: [["updatedAt", "ASC"]],
    limit,
    raw: true,
  });

  for (const shipment of shipments) {
    try {
      if (shipment.status === "created") {
        await refreshCdekShipment(shipment.orderId);
      } else {
        await createCdekShipmentForOrder(shipment.orderId);
      }
    } catch (error) {
      console.error(`[CDEK] Shipment retry failed for order ${shipment.orderId}:`, error.message);
    }
  }
};

module.exports = {
  buildCdekOrderPayload,
  createCdekShipmentForOrder,
  markCdekShipmentReady,
  refreshCdekShipment,
  retryPendingCdekShipments,
};
