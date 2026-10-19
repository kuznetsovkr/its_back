const { RequestValidationError, readString } = require("./requestValidation");
const { POSTAL_POINT_MAX_LENGTH } = require("./orderDelivery");
const { verifyCitySelection } = require("./deliveryCity");

const readPostalDestination = (postalPoint, deliveryCityToken) => {
  const address = readString(postalPoint, "postalPoint", { required: true, max: POSTAL_POINT_MAX_LENGTH });
  const token = readString(deliveryCityToken, "deliveryCityToken", { required: true, max: 2048 });
  let selectedCity;
  try { selectedCity = verifyCitySelection(token); }
  catch (error) { throw new RequestValidationError(error.message, "deliveryCityToken"); }
  return { postalPoint: address, selectedCity };
};
// Zero is the delivery amount charged ONLINE, not a promise of free shipping.
const postalPaymentDelivery = (destination) => ({ deliveryPrice: 0, deliveryPayLater: true,
  tariffCode: null, packages: [], ...destination });
const cartPostalIdentity = (input) => input.deliveryMethod === "russian_post"
  ? { deliveryMethod: "russian_post", postalPoint: input.postalPoint, cityId: input.selectedCity.id } : undefined;

module.exports = { readPostalDestination, postalPaymentDelivery, cartPostalIdentity };
