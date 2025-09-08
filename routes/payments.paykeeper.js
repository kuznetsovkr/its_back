const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { createInvoice } = require('../lib/paykeeper');
const Order = require('../models/Order');
const { finalizePaidOrder } = require('../services/orderFinalizer');

const { PAYKEEPER_SECRET_SEED } = process.env;
const fmt2 = (n) => Number(n).toFixed(2);

router.get('/ping', (_req, res) => res.json({ ok: true }));

// 2.1 Получить ссылку на оплату (всегда 1 ₽)
// routes/payments.paykeeper.js
router.post('/link', async (req, res) => {
  try {
    const { orderId } = req.body;
    console.log('[PK] /link for orderId=', orderId);
    const order = await Order.findByPk(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.paymentStatus === 'paid') return res.status(409).json({ message: 'Order already paid' });

    const pay_amount = fmt2(1);
    const clientid = [order.lastName, order.firstName, order.middleName].filter(Boolean).join(' ') || 'Покупатель';
    const orderid = String(order.id);

    const { invoice_id, pay_url } = await createInvoice({
      pay_amount, clientid, orderid,
      client_email: '', client_phone: order.phone || '',
      service_name: `Тестовая оплата заказа #${order.id}`,
    });

    await order.update({ paymentProvider: 'paykeeper', paymentStatus: 'pending', paykeeperInvoiceId: invoice_id });
    res.json({ pay_url, invoice_id });
  } catch (e) {
    console.error('[PK] /link error:', e.message);
    res.status(500).json({ message: 'Failed to create payment link' });
  }
});

// 2.2 Webhook от PayKeeper (POST-оповещение)
router.post('/callback', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { id, sum, clientid = '', orderid = '', key } = req.body;

    const parsedOrderId = Number.parseInt(orderid, 10);
    if (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0) {
      console.warn('PayKeeper webhook: bad orderid', { orderid });
      return res.status(400).send('Error! Bad orderid');
    }

    const expected = crypto.createHash('md5')
      .update(String(id) + fmt2(sum) + String(clientid) + String(orderid) + PAYKEEPER_SECRET_SEED)
      .digest('hex');

    if (key !== expected) {
      console.warn('PayKeeper webhook: bad signature', { body: req.body, expected });
      return res.status(400).send('Error! Hash mismatch');
    }

    const order = await Order.findByPk(parsedOrderId);
    if (!order) return res.status(404).send('Order not found');

    // сумму можно сверять жёстко (ты пока оставил варнинг — ок)
    if (fmt2(sum) !== fmt2(1)) {
      console.warn('PayKeeper webhook: sum mismatch', { orderid, sum });
    }

    // помечаем как paid (но статус НЕ трогаем)
    if (order.paymentStatus !== 'paid') {
      await order.update({
        paymentStatus: 'paid',
        paykeeperPaymentId: id,
        paidAt: new Date(),
      });
    }

    // финализация (списание, статус, low-stock, Telegram) — идемпотентна
    try {
      await finalizePaidOrder({
        orderId: order.id,
        provider: 'paykeeper',
        eventId: `pk-${id}`,
      });
    } catch (e) {
      // финализация может упасть (например, нет остатка) — оплату приняли, но ты узнаешь из логов и телеги админа
      console.error('Finalize after PayKeeper webhook failed:', e);
    }

    const okHash = crypto.createHash('md5').update(String(id) + PAYKEEPER_SECRET_SEED).digest('hex');
    return res.send(`OK ${okHash}`);
  } catch (e) {
    console.error('paykeeper/callback error', e);
    return res.status(500).send('Error');
  }
});

module.exports = router;
