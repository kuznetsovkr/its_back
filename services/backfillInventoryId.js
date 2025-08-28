// scripts/backfillInventoryId.js
require("dotenv").config();
const sequelize = require("../db");
const Order = require("../models/Order");
const { findInventoryForOrder } = require("../services/inventoryResolver");

(async () => {
  await sequelize.authenticate();
  const orders = await Order.findAll({ where: { inventoryId: null } });
  for (const o of orders) {
    const inv = await findInventoryForOrder(o.productType, o.color, o.size);
    if (inv) {
      o.inventoryId = inv.id;
      await o.save();
      console.log("Linked", o.id, "->", inv.id);
    } else {
      console.warn("No inventory for order", o.id, o.productType, o.color, o.size);
    }
  }
  process.exit(0);
})();
