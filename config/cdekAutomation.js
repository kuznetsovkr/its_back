const isCdekAutoShipmentEnabled = (env = process.env) =>
  String(env.ENABLE_CDEK_AUTO_SHIPMENT || "0") === "1";

module.exports = { isCdekAutoShipmentEnabled };
