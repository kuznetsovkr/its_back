const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const InventoryReservation = require("../models/InventoryReservation");
const OrderShipment = require("../models/OrderShipment");
const { createOrderAccessToken } = require("../middleware/orderAccess");
const { publicOrderPayment } = require("./orderCertificatePricing");

const getCartOrderData = async (orderId, transaction) => {
  const order = await Order.findByPk(orderId, { transaction });
  if (!order?.isCartOrder) return null;
  const items = await OrderItem.findAll({ where: { orderId }, order: [["position", "ASC"]], raw: true, transaction });
  const reservation = await InventoryReservation.findOne({ where: { orderId }, transaction });
  const shipment = await OrderShipment.findOne({ where: { orderId }, transaction });
  return { orderId: order.id, orderToken: createOrderAccessToken(order.id), isCartOrder: true,
    paymentStatus: order.paymentStatus, status: order.status, pricePending: false, cdekNumber: shipment?.cdekNumber || null,
    merchandisePrice: order.merchandiseAmountKopecks / 100, deliveryPrice: order.deliveryAmountKopecks / 100,
    totalPrice: order.totalPrice, ...publicOrderPayment(order), reservationExpiresAt: reservation?.expiresAt || null,
    buyer: { firstName: order.firstName, lastName: order.lastName, middleName: order.middleName || "", phone: order.phone,
      email: order.email || "", preferredContact: order.preferredContact || "", comment: order.comment || "",
      recipientFullName: order.recipientFullName, recipientPhone: order.recipientPhone, deliveryComment: order.deliveryComment || "" },
    officeCode: shipment?.deliveryPoint || "", deliveryAddress: order.deliveryAddress, deliveryCity: order.deliveryCity,
    packages: shipment?.packages || [], items,
  };
};
module.exports = { getCartOrderData };
