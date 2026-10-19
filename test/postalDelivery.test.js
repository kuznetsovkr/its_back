const assert = require("node:assert/strict");
const { test } = require("node:test");
const { issueCitySelection } = require("../lib/deliveryCity");
const { readPostalDestination, postalPaymentDelivery, cartPostalIdentity } = require("../lib/postalDelivery");
const { validateCartQuote } = require("../lib/cartCheckoutRules");

test("postal checkout validates its city and office without requiring a CDEK point or accepting a carrier price", () => {
  const oldSecret = process.env.ORDER_ACCESS_SECRET;
  process.env.ORDER_ACCESS_SECRET = "postal-delivery-fixture-".repeat(3);
  try {
    const city = issueCitySelection({ id: "city:278", name: "Красноярск", label: "г Красноярск", longitude: 92.868, latitude: 56.01 });
    const input = { revision: 1, deliveryMethod: "russian_post", postalPoint: "660000, Красноярск, Мира, 1", deliveryCityToken: city.token };
    const result = validateCartQuote(input);
    assert.equal(result.officeCode, "");
    assert.equal(result.selectedCity.name, city.name);
    assert.equal(postalPaymentDelivery(result).deliveryPrice, 0);
    assert.equal(postalPaymentDelivery(result).deliveryPayLater, true);
    assert.deepEqual(postalPaymentDelivery(result).packages, []);
    assert.deepEqual(cartPostalIdentity(result), { deliveryMethod: "russian_post", postalPoint: input.postalPoint, cityId: city.id });
    assert.equal(cartPostalIdentity({ deliveryMethod: "cdek" }), undefined);
    for (const change of [{ postalPoint: "" }, { postalPoint: "Я".repeat(242) }, { deliveryCityToken: "forged" }, { officeCode: "KRS1" },
      { deliveryMethod: "pickup" }, { deliveryPrice: 1 }, { selectedCity: city }]) assert.throws(() => validateCartQuote({ ...input, ...change }));
    assert.throws(() => readPostalDestination(input.postalPoint, ""));
  } finally { if (oldSecret === undefined) delete process.env.ORDER_ACCESS_SECRET; else process.env.ORDER_ACCESS_SECRET = oldSecret; }
});
