const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Op } = require("sequelize");
const { quoteCartItems } = require("./cartPricing");
const { CartError, CART_RETENTION_MS, MAX_ITEM_QUANTITY, assertCartCapacity, readUuid } = require("../lib/cartRules");
const { UPLOAD_ROOT, isPathInside, persistValidatedImage, resolveSafeFilePath, sanitizeOriginalName } = require("../lib/uploadSecurity");

const CART_UPLOAD_DIR = path.join(UPLOAD_ROOT, "carts");
const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const itemDirectory = (cartId, itemId) => path.join(CART_UPLOAD_DIR, readUuid(cartId), readUuid(itemId));
const attachmentPath = (cartId, itemId, fileName) => {
  const filePath = resolveSafeFilePath(itemDirectory(cartId, itemId), fileName);
  if (!filePath || !isPathInside(CART_UPLOAD_DIR, filePath)) throw new CartError("Фотография недоступна", "cart_attachment_not_found", 404);
  return filePath;
};

const fingerprintItem = async (input, files) => {
  const selection = { ...input };
  delete selection.turnstileToken;
  const descriptors = [];
  for (const file of files) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file.path)) hash.update(chunk);
    descriptors.push({ hash: hash.digest("hex"), size: file.size, mime: file.validatedImage.mime,
      name: sanitizeOriginalName(file.originalname) });
  }
  return tokenHash(JSON.stringify({ selection, files: descriptors }));
};

const createCartService = (overrides = {}) => {
  const deps = {
    sequelize: require("../db"),
    Cart: require("../models/Cart"), CartItem: require("../models/CartItem"), CartAttachment: require("../models/CartAttachment"),
    Inventory: require("../models/Inventory"),
    findInventory: require("./inventoryResolver").findInventoryForOrder,
    calculatePrice: require("./orderPricing").calculateMerchandisePrice,
    getPricingExtras: require("./pricingConfig").getPricingExtras,
    verifyTurnstile: require("./turnstileVerification").verifyTurnstileToken,
    now: () => new Date(),
    persistImage: persistValidatedImage,
    fingerprint: fingerprintItem,
    ...overrides,
  };
  const { sequelize, Cart, CartItem, CartAttachment } = deps;
  const expiry = () => new Date(deps.now().getTime() + CART_RETENTION_MS);
  const loadCart = async ({ cartId, token }, transaction) => {
    const id = readUuid(cartId);
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new CartError("Нет доступа к корзине", "cart_access_required", 401);
    const cart = await Cart.findByPk(id, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    const candidate = tokenHash(token);
    if (!cart || typeof cart.accessTokenHash !== "string" || !/^[a-f0-9]{64}$/.test(cart.accessTokenHash)
      || !crypto.timingSafeEqual(Buffer.from(cart.accessTokenHash), Buffer.from(candidate))) {
      throw new CartError("Корзина недоступна", "cart_not_found", 404);
    }
    if (new Date(cart.expiresAt).getTime() <= deps.now().getTime()) throw new CartError("Срок хранения корзины истёк. Начните новый заказ", "cart_expired", 410);
    return cart;
  };
  const allItems = (cartId, transaction) => CartItem.findAll({ where: { cartId }, raw: true, transaction, order: [["createdAt", "ASC"], ["id", "ASC"]] });
  const allAttachments = (items, transaction) => items.length
    ? CartAttachment.findAll({ where: { cartItemId: items.map((item) => item.id) }, raw: true, transaction, order: [["position", "ASC"]] }) : [];
  const snapshot = async (cart, transaction) => {
    const items = (await allItems(cart.id, transaction)).filter((item) => !item.deletedAt);
    const attachments = await allAttachments(items, transaction);
    const quoted = await quoteCartItems(items, deps);
    return { id: cart.id, expiresAt: new Date(cart.expiresAt).toISOString(), merchandisePrice: quoted.merchandisePrice, items: quoted.items.map((item) => ({
      id: item.id, requestKey: item.requestKey, inventoryId: item.inventoryId, productType: item.productType, color: item.color, size: item.size,
      unitPrice: item.unitPrice, linePrice: item.linePrice, pricingError: item.pricingError, stockWarning: item.stockWarning || "",
      imageUrl: item.imageUrl, embroideryType: item.embroideryType, embroideryTypeRu: item.embroideryTypeRu,
      patronusCount: item.patronusCount, petFaceCount: item.petFaceCount, comment: item.comment, quantity: item.quantity,
      attachments: attachments.filter((file) => file.cartItemId === item.id).map((file) => ({
        id: file.id, originalName: file.originalName, mime: file.mime, size: file.size,
        downloadUrl: `/api/cart/${cart.id}/items/${item.id}/attachments/${file.id}`,
      })),
    })) };
  };
  const capacity = async (cartId, transaction) => {
    const items = await allItems(cartId, transaction);
    const attachments = await allAttachments(items, transaction);
    return { items, bytes: attachments.reduce((total, file) => total + file.size, 0) };
  };
  const assertStock = (items, inventory, addedQuantity) => {
    const count = items.filter((item) => !item.deletedAt && item.inventoryId === inventory?.id)
      .reduce((total, item) => total + item.quantity, 0) + addedQuantity;
    if (!inventory || count > inventory.quantity) throw new CartError("Для выбранного количества недостаточно изделий на складе", "cart_stock_unavailable");
  };
  const findItem = async (cartId, itemId, transaction, includeDeleted = false) => {
    const item = await CartItem.findOne({ where: { id: readUuid(itemId, "itemId"), cartId }, transaction });
    if (!item || (!includeDeleted && item.deletedAt)) throw new CartError("Изделие не найдено в корзине", "cart_item_not_found", 404);
    return item;
  };

  // Delete only files listed by this cart's database records, never a broad tree.
  // Keep records on failure so the periodic worker can retry safely.
  const purgeItemFiles = async (item, transaction) => {
    for (const directory of [path.join(CART_UPLOAD_DIR, readUuid(item.cartId)), itemDirectory(item.cartId, item.id)]) {
      try {
        const stat = await fs.promises.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid cart storage directory");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const attachments = await CartAttachment.findAll({ where: { cartItemId: item.id }, transaction });
    for (const file of attachments) {
      const filePath = attachmentPath(item.cartId, item.id, file.fileName);
      try { await fs.promises.unlink(filePath); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await file.destroy({ transaction });
    }
    try { await fs.promises.rmdir(itemDirectory(item.cartId, item.id)); }
    catch (error) { if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error; }
  };
  const cleanDeletedItem = (cartId, itemId) => sequelize.transaction(async (transaction) => {
    const cart = await Cart.findByPk(cartId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!cart) return;
    const item = await findItem(cartId, itemId, transaction, true);
    if (item.deletedAt && !item.filesPurgedAt) {
      await purgeItemFiles(item, transaction);
      await item.update({ filesPurgedAt: deps.now() }, { transaction });
    }
  });
  const purgeExpiredDirectory = async (cartId) => {
    const directory = path.join(CART_UPLOAD_DIR, readUuid(cartId));
    let entries;
    try {
      const stat = await fs.promises.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid cart storage directory");
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) { if (error.code === "ENOENT") return; throw error; }
    // Also remove orphan files from an interrupted/rolled-back upload, but only
    // generated image names in validated UUID directories belonging to this cart.
    for (const entry of entries) {
      readUuid(entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Unexpected cart storage entry");
      const childDirectory = itemDirectory(cartId, entry.name);
      for (const file of await fs.promises.readdir(childDirectory, { withFileTypes: true })) {
        if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file.name) || !file.isFile() || file.isSymbolicLink()) throw new Error("Unexpected cart attachment entry");
        readUuid(file.name.slice(0, 36));
        await fs.promises.unlink(attachmentPath(cartId, entry.name, file.name));
      }
      await fs.promises.rmdir(childDirectory);
    }
    await fs.promises.rmdir(directory);
  };
  const cleanExpiredCart = (cartId) => sequelize.transaction(async (transaction) => {
    const cart = await Cart.findByPk(readUuid(cartId), { transaction, lock: transaction.LOCK.UPDATE });
    if (!cart || new Date(cart.expiresAt) > deps.now()) return;
    for (const item of await allItems(cart.id, transaction)) await purgeItemFiles(item, transaction);
    await purgeExpiredDirectory(cart.id);
    await cart.destroy({ transaction });
  });

  return {
    async createSession({ turnstileToken = "", remoteIp } = {}) {
      await deps.verifyTurnstile({ token: turnstileToken, remoteIp });
      const token = crypto.randomBytes(32).toString("hex");
      const cart = await Cart.create({ id: crypto.randomUUID(), accessTokenHash: tokenHash(token), expiresAt: expiry(),
        firstUploadProofExpiresAt: new Date(deps.now().getTime() + 5 * 60_000) });
      return { id: cart.id, token, expiresAt: cart.expiresAt };
    },
    assertAccess: loadCart,
    async getCart(access) { return snapshot(await loadCart(access)); },
    async addItem({ access, input, files, requestKey, remoteIp }) {
      const key = readUuid(requestKey, "Idempotency-Key");
      const requestHash = await deps.fingerprint(input, files);
      const createdPaths = [];
      try {
        return await sequelize.transaction(async (transaction) => {
          const cart = await loadCart(access, transaction);
          const existing = await CartItem.findOne({ where: { cartId: cart.id, requestKey: key }, transaction });
          if (existing) {
            if (existing.deletedAt) throw new CartError("Это изделие уже удалено. Для нового изделия нужен новый идентификатор", "cart_item_removed");
            if (existing.requestHash !== requestHash) throw new CartError("С этим идентификатором уже сохранено другое изделие", "cart_request_conflict");
            return { ...await snapshot(cart, transaction), addedItemId: existing.id, alreadyAdded: true };
          }
          if (!cart.firstUploadProofExpiresAt || new Date(cart.firstUploadProofExpiresAt) <= deps.now()) {
            await deps.verifyTurnstile({ token: input.turnstileToken, remoteIp });
          }
          const current = await capacity(cart.id, transaction);
          if (current.items.length >= 100) throw new CartError("Создайте новую корзину: достигнут лимит изменений", "cart_history_limit");
          assertCartCapacity({ ...current, addedItems: 1, addedQuantity: 1, addedBytes: files.reduce((total, file) => total + file.size, 0) });
          const inventory = await deps.findInventory(input.productType, input.color, input.size);
          assertStock(current.items, inventory, 1);
          deps.calculatePrice({ inventory, ...input, pricingConfig: { additional: await deps.getPricingExtras() } });
          const item = await CartItem.create({ id: crypto.randomUUID(), cartId: cart.id, requestKey: key, requestHash,
            inventoryId: inventory.id, productType: inventory.productType, color: inventory.color, size: inventory.size,
            imageUrl: inventory.imageUrl || null, embroideryType: input.embroideryType, embroideryTypeRu: input.embroideryTypeRu,
            patronusCount: input.patronusCount, petFaceCount: input.petFaceCount, comment: input.comment, privacyConsentAt: deps.now(), quantity: 1 }, { transaction });
          for (const [position, file] of files.entries()) {
            const stored = await deps.persistImage(file, itemDirectory(cart.id, item.id));
            createdPaths.push(stored.path);
            await CartAttachment.create({ id: crypto.randomUUID(), cartItemId: item.id, fileName: stored.fileName,
              originalName: sanitizeOriginalName(file.originalname, stored.fileName), mime: stored.mime, size: file.size, position }, { transaction });
          }
          await cart.update({ expiresAt: expiry(), firstUploadProofExpiresAt: null }, { transaction });
          return { ...await snapshot(cart, transaction), addedItemId: item.id, alreadyAdded: false };
        });
      } catch (error) {
        for (const filePath of createdPaths) {
          if (!isPathInside(CART_UPLOAD_DIR, filePath)) continue;
          try { await fs.promises.unlink(filePath); } catch (cleanupError) {
            if (cleanupError.code !== "ENOENT") console.error("[cart] Failed to clean rolled-back attachment");
          }
        }
        throw error;
      }
    },
    async setQuantity(access, itemId, quantity) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) throw new CartError("Количество изделий должно быть целым числом от 1 до 20", "cart_invalid_quantity", 400);
      return sequelize.transaction(async (transaction) => {
        const cart = await loadCart(access, transaction);
        const item = await findItem(cart.id, itemId, transaction);
        if (item.quantity === quantity) return snapshot(cart, transaction);
        const current = await capacity(cart.id, transaction);
        const difference = quantity - item.quantity;
        assertCartCapacity({ ...current, addedQuantity: difference });
        // Reducing a quantity remains possible even if stock changed since adding.
        if (difference > 0) assertStock(current.items, await deps.Inventory.findByPk(item.inventoryId), difference);
        await item.update({ quantity }, { transaction });
        await cart.update({ expiresAt: expiry() }, { transaction });
        return snapshot(cart, transaction);
      });
    },
    async removeItem(access, itemId) {
      const result = await sequelize.transaction(async (transaction) => {
        const cart = await loadCart(access, transaction);
        const item = await findItem(cart.id, itemId, transaction, true);
        if (item.deletedAt) return snapshot(cart, transaction);
        await item.update({ deletedAt: deps.now() }, { transaction });
        await cart.update({ expiresAt: expiry() }, { transaction });
        return snapshot(cart, transaction);
      });
      try { await cleanDeletedItem(access.cartId, itemId); }
      catch (_error) { console.error("[cart] Removed attachment cleanup will be retried"); }
      return result;
    },
    async clearCart(access) {
      await sequelize.transaction(async (transaction) => {
        const cart = await loadCart(access, transaction);
        await cart.update({ expiresAt: deps.now() }, { transaction });
      });
      try { await cleanExpiredCart(access.cartId); }
      catch (_error) { console.error("[cart] Expired cart cleanup will be retried"); }
      return { items: [], expiresAt: null };
    },
    async getAttachment(access, itemId, attachmentId) {
      const cart = await loadCart(access);
      const item = await findItem(cart.id, itemId);
      const file = await CartAttachment.findOne({ where: { id: readUuid(attachmentId, "attachmentId"), cartItemId: item.id } });
      if (!file) throw new CartError("Фотография не найдена в корзине", "cart_attachment_not_found", 404);
      return { filePath: attachmentPath(cart.id, item.id, file.fileName), originalName: file.originalName };
    },
    async cleanUp() {
      let failures = 0;
      for (const cart of await Cart.findAll({ where: { expiresAt: { [Op.lte]: deps.now() } }, attributes: ["id"], limit: 100 })) {
        try { await cleanExpiredCart(cart.id); } catch (_error) { failures += 1; }
      }
      for (const item of await CartItem.findAll({ where: { deletedAt: { [Op.ne]: null }, filesPurgedAt: null }, attributes: ["id", "cartId"], order: [["deletedAt", "ASC"]], limit: 100 })) {
        try { await cleanDeletedItem(item.cartId, item.id); } catch (_error) { failures += 1; }
      }
      if (failures) throw new Error(`Cart cleanup failed for ${failures} records`);
    },
  };
};

module.exports = { CART_UPLOAD_DIR, attachmentPath, createCartService, fingerprintItem, tokenHash };
