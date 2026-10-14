const DELIVERY_METHODS = new Set(["cdek", "russian_post", "pickup", "manual"]);
const SELF_PICKUP = Object.freeze({ city: "Красноярск", address: "Красноярск, ул. Ломоносова, 11" });
const POSTAL_POINT_MAX_LENGTH = 255 - "Почта России, ".length;

const getOrderDelivery = ({ deliveryMethod, deliveryAddress, cdekQuote }) => {
  if (deliveryMethod === "pickup") return { mode: "pickup", city: SELF_PICKUP.city, address: `Самовывоз, ${SELF_PICKUP.address}` };
  if (deliveryMethod === "russian_post") return { mode: "russian_post", city: null, address: `Почта России, ${deliveryAddress}` };
  if (deliveryMethod === "cdek") return {
    mode: "cdek_pvz",
    city: cdekQuote?.office?.location?.city || null,
    address: cdekQuote ? ["СДЭК", cdekQuote.office.code, cdekQuote.office.location?.address, "до ПВЗ"].filter(Boolean).join(", ") : deliveryAddress,
  };
  return { mode: "manual", city: null, address: deliveryAddress };
};

const deliveryModeLabels = Object.freeze({
  cdek_pvz: "СДЭК — до пункта выдачи", russian_post: "Почта России", pickup: "Самовывоз", manual: "Ручное оформление доставки",
});
const getDeliveryModeLabel = (mode) => Object.hasOwn(deliveryModeLabels, mode) ? deliveryModeLabels[mode] : "";

module.exports = { DELIVERY_METHODS, SELF_PICKUP, POSTAL_POINT_MAX_LENGTH, getOrderDelivery, getDeliveryModeLabel };
