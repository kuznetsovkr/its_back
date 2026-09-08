const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  RequestValidationError,
  validateOrderCreateInput,
} = require("../lib/requestValidation");
const {
  buildCdekCalculatePayload,
  buildCdekOfficesParams,
} = require("../lib/cdekRequestValidation");

const validOrder = () => ({
  firstName: "Иван",
  lastName: "Иванов",
  middleName: "",
  phone: "+7 999 123-45-67",
  recipientPhoneDigits: "89991234567",
  recipientFullName: "Иванов Иван",
  email: "",
  preferredContact: "telegram",
  deliveryComment: "",
  deliveryCity: "Красноярск",
  privacyConsent: "true",
  productType: "Футболка",
  color: "Чёрный",
  size: "M",
  embroideryType: "Car",
  embroideryTypeRu: "данные клиента не должны определять подпись",
  patronusCount: "1",
  petFaceCount: "1",
  customText: "",
  customTextFont: "",
  customOption: JSON.stringify({ image: false, text: false }),
  comment: "",
  deliveryAddress: "Красноярск, ул. Примерная, 1",
  cdekMode: "",
  cdekAddress: "",
  cdekAddressLabel: "",
});

test("order validation normalizes trusted values and rejects client price fields", () => {
  const validated = validateOrderCreateInput(validOrder(), [{}]);
  assert.equal(validated.phone, "+79991234567");
  assert.equal(validated.recipientPhone, "+79991234567");
  assert.equal(validated.embroideryType, "Car");
  assert.equal(validated.embroideryTypeRu, "Автомобиль");

  assert.throws(
    () => validateOrderCreateInput({ ...validOrder(), totalPrice: "1" }, [{}]),
    (error) => error instanceof RequestValidationError && /totalPrice/.test(error.message)
  );
});

test("order validation enforces bounded counters and the selected custom mode", () => {
  assert.throws(
    () => validateOrderCreateInput({ ...validOrder(), patronusCount: "999" }, [{}]),
    (error) => error.field === "patronusCount"
  );

  const custom = {
    ...validOrder(),
    embroideryType: "custom",
    customOption: JSON.stringify({ image: false, text: true }),
    customText: "Надпись",
    customTextFont: "Georgia",
  };
  const validated = validateOrderCreateInput(custom, []);
  assert.equal(validated.embroideryTypeRu, "Своя вышивка — надпись");
  assert.equal(validated.customTextFont, "Georgia");
  assert.equal(validated.recipientFullName, "Иванов Иван");
  assert.equal(validated.preferredContact, "telegram");

  assert.throws(
    () => validateOrderCreateInput({ ...custom, customOption: "{}" }, []),
    (error) => error.field === "customOption"
  );
  assert.throws(
    () => validateOrderCreateInput({ ...custom, customTextFont: "Comic Sans MS" }, []),
    (error) => error.field === "customTextFont"
  );
});

test("public CDEK calculation replaces origin and package data with server presets", () => {
  const payload = buildCdekCalculatePayload({
    action: "calculate",
    currency: 1,
    lang: "rus",
    from_location: { code: 999999 },
    to_location: { code: 44 },
    packages: [{ width: 30, height: 20, length: 3, weight: 0.3 }],
  });

  assert.equal(payload.from_location.code, 278);
  assert.equal(payload.to_location.code, 44);
  assert.deepEqual(payload.packages, [{
    number: "1",
    width: 30,
    height: 20,
    length: 3,
    weight: 300,
  }]);

  assert.throws(
    () => buildCdekCalculatePayload({
      action: "calculate",
      to_location: { code: 44 },
      packages: [{ width: 1, height: 1, length: 1, weight: 1 }],
    }),
    (error) => error.field === "packages[0]"
  );
});

test("public CDEK office query accepts only bounded allowlisted filters", () => {
  const params = buildCdekOfficesParams({
    action: "offices",
    type: "PVZ",
    country_code: "RU",
    page: "0",
    size: "100",
    is_handout: "true",
  });
  assert.equal(params.size, 100);
  assert.equal(params.is_handout, true);

  assert.throws(
    () => buildCdekOfficesParams({ action: "offices", size: "10000" }),
    (error) => error.field === "size"
  );
  assert.throws(
    () => buildCdekOfficesParams({ action: "offices", secret_option: "1" }),
    RequestValidationError
  );
});
