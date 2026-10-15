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

test("inscription fonts accept supplied faces and preserve their canonical order value", () => {
  const fonts = ["Book Antiqua", "Century Schoolbook Bold", "Lumios Marker", "Montserrat Bold",
    "Onest Bold", "Swanky and Moo Moo", "Unbounded", "Vasek Italic"];
  for (const customTextFont of fonts) {
    const customText = customTextFont === "Swanky and Moo Moo" ? "Love 2026!" : "Привет, Ёжик! Love 2026";
    const validated = validateOrderCreateInput({ ...validOrder(), embroideryType: "custom",
      customOption: JSON.stringify({ image: false, text: true }), customText, customTextFont }, []);
    assert.equal(validated.customTextFont, customTextFont);
    assert.equal(validated.customText, customText);
  }
});

test("inscription fonts reject unsupported names and Cyrillic in the Latin-only face", () => {
  const custom = { ...validOrder(), embroideryType: "custom", customOption: JSON.stringify({ image: false, text: true }) };
  for (const customTextFont of ["ITS Embroidery Montserrat", "Vasek", "url(evil)", "Unknown Font"]) {
    assert.throws(() => validateOrderCreateInput({ ...custom, customTextFont, customText: "Love" }, []),
      error => error.field === "customTextFont");
  }
  for (const customText of ["Привет", "Loveя", "Ё", "Ї"]) {
    assert.throws(() => validateOrderCreateInput({ ...custom, customTextFont: "Swanky and Moo Moo", customText }, []),
      error => error.field === "customTextFont" && /не поддерживает кириллицу/.test(error.message));
  }
  // The new check must not affect image-based embroidery with stale text fields.
  assert.equal(validateOrderCreateInput({ ...validOrder(), customTextFont: "Swanky and Moo Moo", customText: "Привет" }, [{}]).customTextFont, "");
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

test("delivery methods preserve legacy drafts and reject inconsistent CDEK data", () => {
  assert.equal(validateOrderCreateInput(validOrder(), [{}]).deliveryMethod, "manual");
  const office = { cdekMode: "office", cdekAddress: JSON.stringify({ code: "KRS1" }) };
  assert.equal(validateOrderCreateInput({ ...validOrder(), ...office }, [{}]).deliveryMethod, "cdek");
  assert.throws(() => validateOrderCreateInput({ ...validOrder(), deliveryMethod: "cdek" }, [{}]), (error) => error.field === "cdekMode");
  assert.throws(() => validateOrderCreateInput({ ...validOrder(), deliveryMethod: "courier" }, [{}]), (error) => error.field === "deliveryMethod");
  for (const deliveryMethod of ["pickup", "russian_post", "manual"]) {
    assert.throws(() => validateOrderCreateInput({ ...validOrder(), ...office, deliveryMethod }, [{}]), (error) => error.field === "deliveryMethod");
  }
});

test("pickup address is server-owned and postal requests require a bounded office description", () => {
  assert.equal(validateOrderCreateInput({ ...validOrder(), deliveryMethod: "pickup", deliveryAddress: "Подменённый адрес", deliveryCity: "Подменённый город" }, [{}]).deliveryAddress,
    "Красноярск, ул. Ломоносова, 11");
  assert.equal(validateOrderCreateInput({ ...validOrder(), deliveryMethod: "pickup", deliveryAddress: "" }, [{}]).deliveryMethod, "pickup");
  assert.throws(() => validateOrderCreateInput({ ...validOrder(), deliveryMethod: "russian_post", deliveryAddress: " " }, [{}]),
    (error) => error.field === "deliveryAddress" && error.message.includes("Почты России"));
  assert.throws(() => validateOrderCreateInput({ ...validOrder(), deliveryMethod: "russian_post", deliveryAddress: "Я".repeat(301) }, [{}]), (error) => error.field === "deliveryAddress");
  assert.equal(validateOrderCreateInput({ ...validOrder(), deliveryMethod: "russian_post", deliveryAddress: "Я".repeat(241) }, [{}]).deliveryAddress.length, 241);
  assert.throws(() => validateOrderCreateInput({ ...validOrder(), deliveryMethod: "russian_post", deliveryAddress: "Я".repeat(242) }, [{}]), (error) => error.field === "deliveryAddress");
  assert.throws(() => validateOrderCreateInput({ ...validOrder(), deliveryMethod: "russian_post", deliveryAddress: "Адрес\nс подменой" }, [{}]), (error) => error.field === "deliveryAddress");
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

test("cart widget accepts at most 50 known package presets and rejects a forged package anywhere in the array", () => {
  const parcel = { width: 30, height: 20, length: 3, weight: .3 };
  const body = { to_location: { code: 44 }, packages: Array.from({ length: 50 }, () => ({ ...parcel })) };
  const profiles = [{ ...parcel, weight: 300 }];
  assert.equal(buildCdekCalculatePayload(body, profiles).packages.length, 50);
  assert.throws(() => buildCdekCalculatePayload({ ...body, packages: [...body.packages, parcel] }, profiles), (error) => error.field === "packages");
  body.packages[49].weight = 0;
  assert.throws(() => buildCdekCalculatePayload(body, profiles), (error) => error.field === "packages[49]");
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
