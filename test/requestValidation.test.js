const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  RequestValidationError,
  validateOrderCreateInput,
} = require("../lib/requestValidation");
const {
  buildCdekCalculatePayload,
  buildCdekOfficesByCoordinateParams,
  buildCdekOfficesParams,
} = require("../lib/cdekRequestValidation");

const validOrder = () => ({
  firstName: "Иван",
  lastName: "Иванов",
  middleName: "",
  phone: "+7 999 123-45-67",
  recipientPhoneDigits: "",
  recipientFullName: "",
  email: "",
  preferredContact: "telegram",
  deliveryComment: "",
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
  turnstileToken: "turnstile-response-token",
});

test("order validation normalizes trusted values and rejects client price fields", () => {
  const validated = validateOrderCreateInput(validOrder(), [{}]);
  assert.equal(validated.phone, "+79991234567");
  assert.equal(validated.recipientPhone, "+79991234567");
  assert.equal(validated.recipientFullName, "Иванов Иван");
  assert.equal(validated.embroideryType, "Car");
  assert.equal(validated.embroideryTypeRu, "Автомобиль");
  assert.equal(validated.turnstileToken, "turnstile-response-token");
  assert.equal(validateOrderCreateInput({ ...validOrder(), certificateCode: "ITS" + "A1".repeat(16) }, [{}]).certificateCode, "ITS" + "A1".repeat(16));
  for (const field of ["certificateDiscountKopecks", "amountDueKopecks", "certificateId", "paymentTestMode"]) {
    assert.throws(() => validateOrderCreateInput({ ...validOrder(), [field]: 1 }, [{}]), RequestValidationError);
  }

  assert.throws(
    () => validateOrderCreateInput({ ...validOrder(), totalPrice: "1" }, [{}]),
    (error) => error instanceof RequestValidationError && /totalPrice/.test(error.message)
  );
});

test("order validation enforces bounded counters and the selected custom mode", () => {
  assert.equal(validateOrderCreateInput({
    ...validOrder(), embroideryType: "Patronus", patronusCount: "4",
  }, [{}]).patronusCount, 4);
  assert.throws(
    () => validateOrderCreateInput({
      ...validOrder(), embroideryType: "Patronus", patronusCount: "5",
    }, [{}]),
    (error) => error.field === "patronusCount" && /не более 4 патронусов/.test(error.message)
  );
  assert.equal(validateOrderCreateInput({
    ...validOrder(), embroideryType: "Car", patronusCount: "5",
  }, [{}]).embroideryType, "Car");
  assert.equal(validateOrderCreateInput({
    ...validOrder(), embroideryType: "petFace", petFaceCount: "5",
  }, [{}]).petFaceCount, 5);
  assert.throws(
    () => validateOrderCreateInput({ ...validOrder(), petFaceCount: "6" }, [{}]),
    (error) => error.field === "petFaceCount"
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

  const comicSans = validateOrderCreateInput({ ...custom, customTextFont: "Comic Sans MS" }, []);
  assert.equal(comicSans.customTextFont, "Comic Sans MS");

  assert.throws(
    () => validateOrderCreateInput({ ...custom, customOption: "{}" }, []),
    (error) => error.field === "customOption"
  );
  assert.throws(
    () => validateOrderCreateInput({ ...custom, customTextFont: "Unsupported Font" }, []),
    (error) => error.field === "customTextFont"
  );
});

test("another recipient requires their own valid phone", () => {
  const namedRecipient = { ...validOrder(), recipientFullName: "Петров Пётр" };
  assert.throws(
    () => validateOrderCreateInput(namedRecipient, [{}]),
    (error) => error.field === "recipientPhoneDigits"
  );
  assert.throws(
    () => validateOrderCreateInput({ ...validOrder(), recipientPhoneDigits: "89123456789" }, [{}]),
    (error) => error.field === "recipientFullName"
  );
  assert.throws(
    () => validateOrderCreateInput({ ...namedRecipient, recipientPhoneDigits: "123" }, [{}]),
    (error) => error.field === "recipientPhoneDigits"
  );

  const validated = validateOrderCreateInput({
    ...namedRecipient,
    recipientPhoneDigits: "89123456789",
  }, [{}]);
  assert.equal(validated.recipientFullName, "Петров Пётр");
  assert.equal(validated.recipientPhone, "+79123456789");
});

test("legacy city input cannot override the server-provided location", () => {
  const validated = validateOrderCreateInput({ ...validOrder(), deliveryCity: "Чужой город" }, [{}]);
  assert.equal(Object.hasOwn(validated, "deliveryCity"), false);
});

test("public CDEK calculation replaces origin and uses a package profile from the catalog", () => {
  const payload = buildCdekCalculatePayload({
    action: "calculate",
    currency: 1,
    lang: "rus",
    from_location: { code: 999999 },
    to_location: { code: 44 },
    packages: [{ width: 30, height: 20, length: 3, weight: 0.3 }],
  }, [{ width: 30, height: 20, length: 3, weight: 300 }]);

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
    }, [{ width: 30, height: 20, length: 3, weight: 300 }]),
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

test("public CDEK polygon query validates viewport bounds and filters", () => {
  const params = buildCdekOfficesByCoordinateParams({
    action: "byCoordinate",
    latitude_right_top: "56.2",
    longitude_right_top: "93.1",
    latitude_left_bottom: "55.8",
    longitude_left_bottom: "92.6",
    type: "all",
    is_handout: "true",
    have_cashless: "false",
  });

  assert.deepEqual(params, {
    latitude_right_top: 56.2,
    longitude_right_top: 93.1,
    latitude_left_bottom: 55.8,
    longitude_left_bottom: 92.6,
    type: "ALL",
    have_cashless: false,
    is_handout: true,
  });

  assert.throws(
    () => buildCdekOfficesByCoordinateParams({
      action: "byCoordinate",
      latitude_right_top: "56.2",
      longitude_right_top: "93.1",
      latitude_left_bottom: "57",
      longitude_left_bottom: "92.6",
    }),
    (error) => error.field === "latitude_right_top"
  );
  assert.throws(
    () => buildCdekOfficesByCoordinateParams({
      action: "byCoordinate",
      latitude_right_top: "56.2",
      longitude_right_top: "181",
      latitude_left_bottom: "55.8",
      longitude_left_bottom: "92.6",
    }),
    (error) => error.field === "longitude_right_top"
  );
  assert.throws(
    () => buildCdekOfficesByCoordinateParams({
      action: "byCoordinate",
      latitude_right_top: "56.2",
      longitude_right_top: "93.1",
      latitude_left_bottom: "55.8",
      longitude_left_bottom: "92.6",
      unexpected: "1",
    }),
    RequestValidationError
  );
});
