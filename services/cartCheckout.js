const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { CartError, readUuid } = require("../lib/cartRules");
const { hashCheckout, assertCartRevision, assertCartMutable } = require("../lib/cartCheckoutRules");
const { ORDER_UPLOAD_DIR, inspectStoredImage, isPathInside } = require("../lib/uploadSecurity");
const { calculateMerchandisePrice, calculateCdekDelivery, getGoodsPreset } = require("./orderPricing");
const { getOrderDelivery } = require("../lib/orderDelivery");
const { postalPaymentDelivery, cartPostalIdentity } = require("../lib/postalDelivery");
const { combineShippingPackages } = require("../lib/shippingPackages");
const { buildOrderPaymentSnapshot, publicOrderPayment, rublesToKopecks } = require("./orderCertificatePricing");
const { quoteCertificateForOrder, reserveCertificateForOrder, releaseCertificateForOrder } = require("./giftCertificates");
const { getReservationTtlMs, releaseReservationForOrder } = require("./inventoryReservations");

const createCartCheckoutService = (overrides = {}) => {
  const deps = {
    sequelize: require("../db"), CartItem: require("../models/CartItem"), CartAttachment: require("../models/CartAttachment"),
    Order: require("../models/Order"), OrderItem: require("../models/OrderItem"), Checkout: require("../models/CartCheckout"),
    Inventory: require("../models/Inventory"), ClothingType: require("../models/ClothingType"), Reservation: require("../models/InventoryReservation"),
    Shipment: require("../models/OrderShipment"), Attachment: require("../models/OrderAttachment"),
    carts: require("./carts").createCartService(),
    getPricingExtras: require("./pricingConfig").getPricingExtras,
    calculateDelivery: calculateCdekDelivery, verifyTurnstile: require("./turnstileVerification").verifyTurnstileToken,
    copyFile: (source, target) => fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL),
    ...overrides,
  };
  const { sequelize, carts, Checkout, Order } = deps;
  const rows = (cartId, transaction) => deps.CartItem.findAll({ where: { cartId, deletedAt: null }, raw: true, order: [["createdAt", "ASC"], ["id", "ASC"]], transaction });
  const priceItems = async (items, transaction) => {
    if (!items.length) throw new CartError("В корзине нет изделий", "cart_empty", 400);
    if (items.length > 20 || items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)
      || items.reduce((sum, item) => sum + item.quantity, 0) > 50) throw new CartError("Превышено допустимое количество изделий в корзине", "cart_quantity_limit", 400);
    const inventoryById = new Map();
    // A fixed global order prevents two overlapping baskets from deadlocking.
    for (const id of [...new Set(items.map((item) => item.inventoryId))].sort((a, b) => a - b)) {
      const inventory = await deps.Inventory.findByPk(id, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
      if (!inventory) throw new CartError("Одно из изделий больше недоступно. Обновите корзину", "cart_stock_unavailable");
      inventory.clothingType = await deps.ClothingType.findByPk(inventory.clothingTypeId, { transaction });
      inventoryById.set(id, inventory);
    }
    const pricingConfig = { additional: await deps.getPricingExtras({ transaction }) };
    const lines = items.map((item) => {
      const inventory = inventoryById.get(item.inventoryId);
      if (inventory.productType !== item.productType || inventory.color !== item.color || inventory.size !== item.size) {
        throw new CartError("Параметры изделия изменились в каталоге. Удалите его из корзины и выберите заново", "cart_item_changed");
      }
      if (!["Patronus", "Car", "petFace"].includes(item.embroideryType)) throw new CartError("Индивидуальную вышивку нужно оформить отдельной заявкой", "cart_manual_item", 400);
      const quoted = calculateMerchandisePrice({ inventory, embroideryType: item.embroideryType,
        carDesign: item.carDesign,
        patronusCount: item.patronusCount, petFaceCount: item.petFaceCount, pricingConfig });
      return { ...item, unitPrice: quoted.merchandisePrice, linePrice: quoted.merchandisePrice * item.quantity, parcel: getGoodsPreset(inventory) };
    });
    for (const [id, inventory] of inventoryById) {
      const quantity = lines.filter((line) => line.inventoryId === id).reduce((sum, line) => sum + line.quantity, 0);
      if (quantity > inventory.quantity) throw new CartError(`Недостаточно изделий: ${inventory.productType}, ${inventory.color}, ${inventory.size}`, "cart_stock_unavailable");
    }
    return { lines, inventoryById, merchandisePrice: lines.reduce((sum, item) => sum + item.linePrice, 0) };
  };
  const fingerprint = (priced, input, delivery, payment) => hashCheckout({ revision: input.revision, officeCode: input.officeCode,
    postal: cartPostalIdentity(input),
    certificate: hashCheckout(String(input.certificateCode || "").trim().toUpperCase()),
    lines: priced.lines.map((line) => [line.id, line.requestHash, line.quantity, line.unitPrice, line.parcel]),
    deliveryPrice: delivery.deliveryPrice, tariffCode: delivery.tariffCode, packages: delivery.packages,
    discount: payment.certificateDiscountKopecks, amountDue: payment.amountDueKopecks, paymentAmount: payment.paymentAmount, paymentTestMode: payment.paymentTestMode });
  const prepareQuote = async (access, input) => {
    const cart = await carts.lockCart(access);
    assertCartMutable(cart); assertCartRevision(cart, input.revision);
    const priced = await priceItems(await rows(cart.id));
    const packages = priced.lines.flatMap((line) => Array.from({ length: line.quantity }, () => ({ ...line.parcel })));
    packages.forEach((parcel, index) => { parcel.number = String(index + 1); });
    const delivery = input.deliveryMethod === "russian_post" ? postalPaymentDelivery({ postalPoint: input.postalPoint, selectedCity: input.selectedCity })
      : await deps.calculateDelivery({ packages: combineShippingPackages(packages), merchandisePrice: priced.merchandisePrice, cdekMode: "office", cdekAddress: { code: input.officeCode } });
    const certificate = input.certificateCode ? await quoteCertificateForOrder({ code: input.certificateCode,
      productKopecks: rublesToKopecks(priced.merchandisePrice), deliveryKopecks: rublesToKopecks(delivery.deliveryPrice, true) }) : null;
    const payment = buildOrderPaymentSnapshot({ merchandisePrice: priced.merchandisePrice, deliveryPrice: delivery.deliveryPrice, discountKopecks: certificate?.discountKopecks || 0 });
    // Verify that a concurrent tab did not change the cart during the CDEK call.
    assertCartRevision(await carts.lockCart(access), input.revision);
    return { priced, delivery, certificate, payment, quoteHash: fingerprint(priced, input, delivery, payment) };
  };
  const publicQuote = (prepared, input) => ({ currency: "RUB", manual: false, isCartOrder: true, revision: input.revision,
    merchandisePrice: prepared.priced.merchandisePrice, deliveryPrice: prepared.delivery.deliveryPayLater ? null : prepared.delivery.deliveryPrice,
    deliveryPayLater: Boolean(prepared.delivery.deliveryPayLater),
    insurancePrice: prepared.delivery.insurancePrice ?? null,
    totalPrice: prepared.priced.merchandisePrice + prepared.delivery.deliveryPrice,
    ...publicOrderPayment(prepared.payment), quoteHash: prepared.quoteHash, packages: prepared.delivery.packages,
    certificate: prepared.certificate ? { discount: prepared.certificate.discountKopecks / 100, remaining: prepared.certificate.remainingKopecks / 100, expiresAt: prepared.certificate.expiresAt } : null,
  });
  const orderData = (id, transaction) => require("./cartOrderData").getCartOrderData(id, transaction);
  return {
    quote: async (access, input) => publicQuote(await prepareQuote(access, input), input),
    async create(access, input, requestKey, remoteIp) {
      const key = readUuid(requestKey, "Idempotency-Key");
      const requestHash = hashCheckout({ revision: input.revision, officeCode: input.officeCode, certificateCode: input.certificateCode, buyer: input.buyer, postal: cartPostalIdentity(input) });
      await carts.assertAccess(access);
      const replay = async (record, transaction) => {
        if (record.cartId !== access.cartId || record.requestHash !== requestHash) throw new CartError("Запрос оформления изменился. Обновите корзину", "cart_checkout_conflict");
        const existing = await orderData(record.orderId, transaction);
        if (!existing || ["cancelled", "expired", "failed"].includes(existing.paymentStatus)) throw new CartError("Это оформление уже отменено или его резерв истёк. Пересчитайте корзину", "cart_checkout_inactive");
        return existing;
      };
      const previous = await Checkout.findByPk(key);
      if (previous) return replay(previous);
      const prepared = await prepareQuote(access, input);
      if (prepared.quoteHash !== input.quoteHash) throw new CartError("Стоимость или состав корзины изменились. Проверьте новый расчёт перед оплатой", "cart_quote_changed");
      await deps.verifyTurnstile({ token: input.turnstileToken, remoteIp });
      const copied = [];
      try {
        return await sequelize.transaction(async (transaction) => {
          const cart = await carts.lockCart(access, transaction);
          const concurrent = await Checkout.findByPk(key, { transaction });
          if (concurrent) return replay(concurrent, transaction);
          assertCartMutable(cart); assertCartRevision(cart, input.revision);
          const priced = await priceItems(await rows(cart.id, transaction), transaction);
          if (fingerprint(priced, input, prepared.delivery, prepared.payment) !== input.quoteHash) throw new CartError("Стоимость или состав корзины изменились. Пересчитайте заказ", "cart_quote_changed");
          const delivery = getOrderDelivery({ deliveryMethod: input.deliveryMethod || "cdek", cdekQuote: prepared.delivery,
            deliveryAddress: input.postalPoint, selectedCity: input.selectedCity });
          const quantity = priced.lines.reduce((sum, line) => sum + line.quantity, 0);
          const order = await Order.create({ ...input.buyer, recipientPhone: input.buyer.recipientPhone,
            email: input.buyer.email || null, isCartOrder: true, inventoryId: null,
            productType: `Корзина: ${quantity} шт.`, color: "Несколько изделий", size: "По позициям",
            embroideryType: "cart", embroideryTypeRu: "Вышивка по позициям", privacyConsentAt: new Date(),
            status: "Ожидание оплаты", paymentStatus: "pending", totalPrice: priced.merchandisePrice + prepared.delivery.deliveryPrice,
            ...buildOrderPaymentSnapshot({ merchandisePrice: priced.merchandisePrice, deliveryPrice: prepared.delivery.deliveryPrice }),
            deliveryMode: delivery.mode, deliveryCity: delivery.city, deliveryAddress: delivery.address,
          }, { transaction });
          const expiresAt = new Date(Date.now() + getReservationTtlMs());
          for (const [id, inventory] of priced.inventoryById) {
            const count = priced.lines.filter((line) => line.inventoryId === id).reduce((sum, line) => sum + line.quantity, 0);
            inventory.quantity -= count; await inventory.save({ transaction });
            await deps.Reservation.create({ orderId: order.id, inventoryId: id, quantity: count, status: "active", expiresAt }, { transaction });
          }
          if (input.certificateCode) {
            const reserved = await reserveCertificateForOrder({ orderId: order.id, code: input.certificateCode,
              productAmountKopecks: prepared.payment.merchandiseAmountKopecks, expiresAt, transaction });
            if (reserved.amountKopecks !== prepared.payment.certificateDiscountKopecks) throw new CartError("Доступный баланс сертификата изменился. Пересчитайте заказ", "cart_quote_changed");
            await order.update({ ...prepared.payment, certificateId: reserved.certificateId }, { transaction });
          }
          const shipmentItems = [];
          for (const [position, line] of priced.lines.entries()) {
            const item = await deps.OrderItem.create({ orderId: order.id, sourceCartItemId: line.id, position,
              inventoryId: line.inventoryId, productType: line.productType, color: line.color, size: line.size, imageUrl: line.imageUrl,
              embroideryType: line.embroideryType, embroideryTypeRu: line.embroideryTypeRu, patronusCount: line.patronusCount,
              carDesign: line.carDesign,
              petFaceCount: line.petFaceCount, comment: line.comment, quantity: line.quantity, unitPrice: line.unitPrice, linePrice: line.linePrice, parcel: line.parcel }, { transaction });
            shipmentItems.push({ name: line.productType, ware_key: `ORDER-${order.id}-ITEM-${item.id}`, cost: line.unitPrice,
              payment: { value: 0 }, weight: line.parcel.weight, amount: line.quantity });
            const attachments = await deps.CartAttachment.findAll({ where: { cartItemId: line.id }, order: [["position", "ASC"]], transaction });
            if (!attachments.length) throw new CartError("Для одного из изделий не сохранились фотографии. Добавьте изделие заново", "cart_photo_missing");
            const directory = path.join(ORDER_UPLOAD_DIR, String(order.id));
            if (!isPathInside(ORDER_UPLOAD_DIR, directory)) throw new Error("Invalid order attachment directory");
            await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
            const stat = await fs.promises.lstat(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid order attachment directory");
            for (const attachment of attachments) {
              const source = await carts.getAttachment(access, line.id, attachment.id);
              const info = await inspectStoredImage(source.filePath);
              const target = path.join(directory, `${crypto.randomUUID()}${info.extension}`);
              await deps.copyFile(source.filePath, target); copied.push(target);
              await fs.promises.chmod(target, 0o600);
              await deps.Attachment.create({ orderId: order.id, orderItemId: item.id, path: target, mime: info.mime, originalName: attachment.originalName, size: info.size }, { transaction });
            }
          }
          if (input.deliveryMethod !== "russian_post") await deps.Shipment.create({ orderId: order.id, provider: "cdek", status: "pending_payment", tariffCode: prepared.delivery.tariffCode,
            deliveryPoint: prepared.delivery.office.code, recipientName: input.buyer.recipientFullName, recipientPhone: input.buyer.recipientPhone,
            declaredValue: priced.merchandisePrice,
            packages: prepared.delivery.packages.map(parcel => ({ ...parcel, number: `order-${order.id}-1`, items: shipmentItems })) }, { transaction });
          await Checkout.create({ id: key, cartId: cart.id, orderId: order.id, requestHash }, { transaction });
          await cart.update({ checkoutOrderId: order.id }, { transaction });
          return orderData(order.id, transaction);
        });
      } catch (error) {
        // A lost COMMIT acknowledgement is not proof of rollback. Keep copies
        // unless a healthy DB confirms that no durable checkout was created.
        const durable = await Checkout.findByPk(key).catch(() => undefined);
        if (durable === null) await Promise.all(copied.map((file) => fs.promises.unlink(file).catch(() => undefined)));
        throw error;
      }
    },
    async cancel(access) {
      const read = await carts.lockCart(access);
      if (!read.checkoutOrderId) return carts.getCart(access);
      await sequelize.transaction(async (transaction) => {
        const order = await Order.findByPk(read.checkoutOrderId, { transaction, lock: transaction.LOCK.UPDATE });
        const cart = await carts.lockCart(access, transaction);
        if (cart.checkoutOrderId !== order?.id) return;
        if (order.paymentStatus !== "pending") throw new CartError("Оплаченный заказ или заказ на проверке нельзя отменить автоматически. Обратитесь к менеджеру", "cart_checkout_not_cancellable");
        await releaseReservationForOrder(order.id, "cancelled", transaction, true);
        if (order.certificateId) await releaseCertificateForOrder({ orderId: order.id, reason: "cancelled", transaction });
        await order.update({ paymentStatus: "cancelled", status: "Отменен" }, { transaction });
        await require("./cartOrderLifecycle").unlockCartOrder(order.id, transaction);
      });
      return carts.getCart(access);
    },
  };
};
module.exports = { createCartCheckoutService };
