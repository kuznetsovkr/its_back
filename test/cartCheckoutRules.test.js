const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCartQuote, validateCartCheckout, assertCartRevision, assertCartMutable } = require("../lib/cartCheckoutRules");
const buyer = { firstName: "Иван", lastName: "Иванов", middleName: "", phone: "89991234567", email: "buyer@example.com", privacyConsent: true };
const input = () => ({ revision: 0, officeCode: "KRS-1", certificateCode: "", quoteHash: "a".repeat(64), turnstileToken: "fixture", buyer: { ...buyer } });
test("cart checkout normalizes the existing buyer/recipient contract without accepting client prices", () => {
  const value = validateCartCheckout(input());
  assert.equal(value.buyer.phone, "+79991234567");
  assert.equal(value.buyer.recipientPhone, value.buyer.phone);
  assert.equal(value.buyer.recipientFullName, "Иванов Иван");
  for (const field of ["price", "items", "quantity", "deliveryPrice", "paymentAmount", "packages", "discount"]) assert.throws(() => validateCartCheckout({ ...input(), [field]: 1 }));
  for (const revision of [undefined, "0", -1, 0.5, NaN, 2_000_000_001]) assert.throws(() => validateCartQuote({ revision, officeCode: "KRS-1" }));
});
test("cart checkout requires consent, valid Russian contact data and the other recipient's phone", () => {
  for (const changes of [{ privacyConsent: false }, { phone: "123" }, { firstName: "" }, { email: "bad" }, { recipientFullName: "Петров Пётр" }, { recipientPhoneDigits: "79998887766" }]) {
    assert.throws(() => validateCartCheckout({ ...input(), buyer: { ...buyer, ...changes } }));
  }
  const result = validateCartCheckout({ ...input(), buyer: { ...buyer, recipientFullName: "Петров Пётр", recipientPhoneDigits: "89998887766" } });
  assert.equal(result.buyer.recipientPhone, "+79998887766");
});
test("stale cart versions and a checkout in progress cannot be mutated", () => {
  assert.throws(() => assertCartRevision({ revision: 2 }, 1), { code: "cart_changed" });
  assert.throws(() => assertCartMutable({ checkoutOrderId: 12 }), { code: "cart_checkout_locked" });
  assert.doesNotThrow(() => assertCartRevision({ revision: 2 }, 2));
});
