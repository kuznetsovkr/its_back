const Cart = require("../models/Cart");
const CartCheckout = require("../models/CartCheckout");
const CartItem = require("../models/CartItem");
const OrderItem = require("../models/OrderItem");

// All callers lock the order before its cart. New checkout creation never locks
// an existing order while holding a cart, so cancellation and payment cannot deadlock.
const unlockCartOrder = async (orderId, transaction, paid = false) => {
  const checkout = await CartCheckout.findOne({ where: { orderId }, transaction });
  if (!checkout?.cartId) return;
  const cart = await Cart.findByPk(checkout.cartId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!cart || cart.checkoutOrderId !== orderId) return;
  if (paid) {
    const items = await OrderItem.findAll({ where: { orderId }, attributes: ["sourceCartItemId"], raw: true, transaction });
    if (items.length) await CartItem.update({ deletedAt: new Date() }, { where: { cartId: cart.id, id: items.map((item) => item.sourceCartItemId) }, transaction });
  }
  await cart.update({ checkoutOrderId: null, revision: cart.revision + 1 }, { transaction });
};
module.exports = { unlockCartOrder };
