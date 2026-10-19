const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

const {
  PricingError,
  calculateCdekDelivery,
  calculateMerchandisePrice,
  getPriceCatalog,
} = require("../services/orderPricing");

const profiles = {
  tshirt: {
    code: "tshirt", patronusLimit: 1,
    patronusPrice: 8500, carPrice: 6500, carSimplePrice: 5000, carMediumPrice: 7000, carComplexPrice: null, petFacePrice: 6000,
    packageWidth: 25, packageHeight: 3, packageLength: 30, packageWeight: 300,
  },
  svitshot: {
    code: "svitshot", patronusLimit: 5,
    patronusPrice: 9500, carPrice: 8000, carSimplePrice: 6000, carMediumPrice: 8000, carComplexPrice: 11000, petFacePrice: 7000,
    packageWidth: 35, packageHeight: 7, packageLength: 35, packageWeight: 800,
  },
  hoodie: {
    code: "hoodie", patronusLimit: 5,
    patronusPrice: 10000, carPrice: 8500, carSimplePrice: 6500, carMediumPrice: 8500, carComplexPrice: 11500, petFacePrice: 8000,
    packageWidth: 35, packageHeight: 7, packageLength: 35, packageWeight: 800,
  },
};
const inventory = (key, overrides = {}) => ({
  productType: key,
  clothingType: { ...profiles[key], ...overrides },
});
const pricingConfig = {
  additional: { Patronus: 5000, petFace: 2000 },
};

test("сервер рассчитывает каталог цен для выбранного изделия", () => {
  assert.deepEqual(
    getPriceCatalog({
      inventory: inventory("hoodie"),
      patronusCount: 2,
      petFaceCount: 3,
      pricingConfig,
    }),
    {
      Patronus: 15000,
      Car: 6500,
      petFace: 12000,
    }
  );
});

test("расчёт использует профиль изделия и серверные доплаты без скрытых констант", () => {
  const changedConfig = {
    additional: { ...pricingConfig.additional, Patronus: 777 },
  };

  assert.equal(calculateMerchandisePrice({
    inventory: inventory("hoodie", { carSimplePrice: 12345 }),
    embroideryType: "Car",
    carDesign: "simple",
    pricingConfig: changedConfig,
  }).merchandisePrice, 12345);
  assert.equal(calculateMerchandisePrice({
    inventory: inventory("hoodie"),
    embroideryType: "Patronus",
    patronusCount: 2,
    pricingConfig: changedConfig,
  }).merchandisePrice, 10777);
});

test("расчёт не определяет профиль изделия по его названию", () => {
  const arbitraryInventory = {
    productType: "Любое новое название",
    clothingType: {
      ...profiles.hoodie,
      code: "custom-garment",
      carSimplePrice: 4321,
    },
  };
  assert.equal(calculateMerchandisePrice({
    inventory: arbitraryInventory,
    embroideryType: "Car",
    carDesign: "simple",
    pricingConfig,
  }).merchandisePrice, 4321);
});

test("сервер отклоняет недопустимое количество вышивок", () => {
  assert.throws(
    () => calculateMerchandisePrice({
      inventory: inventory("tshirt"),
      embroideryType: "Patronus",
      patronusCount: 2,
      pricingConfig,
    }),
    (error) => error instanceof PricingError && /не более 1/.test(error.message)
  );
  assert.equal(calculateMerchandisePrice({
    inventory: inventory("hoodie"),
    embroideryType: "Patronus",
    patronusCount: 4,
    pricingConfig,
  }).merchandisePrice, 25000);
  assert.throws(
    () => calculateMerchandisePrice({
      inventory: inventory("hoodie"),
      embroideryType: "Patronus",
      patronusCount: 5,
      pricingConfig,
    }),
    (error) => error instanceof PricingError && /не более 4 патронусов/.test(error.message)
  );
  assert.equal(calculateMerchandisePrice({
    inventory: inventory("hoodie"),
    embroideryType: "petFace",
    petFaceCount: 5,
    pricingConfig,
  }).merchandisePrice, 16000);
  assert.throws(
    () => calculateMerchandisePrice({
      inventory: inventory("hoodie"),
      embroideryType: "petFace",
      petFaceCount: 6,
      pricingConfig,
    }),
    (error) => error instanceof PricingError && /не более 5 портретов/.test(error.message)
  );
  assert.equal(calculateMerchandisePrice({
    inventory: inventory("hoodie"),
    embroideryType: "Car",
    patronusCount: 5,
    carDesign: "medium",
    pricingConfig,
  }).merchandisePrice, 8500);
});

test("индивидуальная вышивка переводит заказ на ручной расчёт", () => {
  assert.deepEqual(
    calculateMerchandisePrice({
      inventory: inventory("svitshot"),
      embroideryType: "custom",
      pricingConfig,
    }),
    {
      manual: true,
      merchandisePrice: null,
      clothingTypeCode: "svitshot",
      embroideryType: "custom",
    }
  );
});

test("стоимость доставки пересчитывается по данным ПВЗ от СДЭК", { concurrency: false }, async () => {
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalEnv = {
    CDEK_CLIENT_ID: process.env.CDEK_CLIENT_ID,
    CDEK_CLIENT_SECRET: process.env.CDEK_CLIENT_SECRET,
    CDEK_FROM_CITY_CODE: process.env.CDEK_FROM_CITY_CODE,
    CDEK_CHECKOUT_TARIFF_CODE: process.env.CDEK_CHECKOUT_TARIFF_CODE,
  };

  process.env.CDEK_CLIENT_ID = "test-client";
  process.env.CDEK_CLIENT_SECRET = "test-secret";
  process.env.CDEK_FROM_CITY_CODE = "278";
  process.env.CDEK_CHECKOUT_TARIFF_CODE = "136";

  axios.get = async (_url, config) => {
    assert.equal(config.params.code, "KRS1");
    return {
      data: [{ code: "KRS1", location: { city_code: 44, city: "Красноярск", address: "Настоящий адрес" } }],
    };
  };
  let responseTariff = { delivery_sum: 580, total_sum: 687.75, services: [{ code: "INSURANCE", total_sum: 78.75 }] };
  axios.post = async (url, payload) => {
    if (url.endsWith("/oauth/token")) {
      return { data: { access_token: "test-token", expires_in: 3600 } };
    }

    assert.equal(payload.from_location.code, 278);
    assert.equal(payload.to_location.code, 44);
    assert.equal(payload.packages[0].weight, 800);
    assert.ok(url.endsWith("/calculator/tariff"));
    assert.equal(payload.tariff_code, 136);
    assert.equal(payload.delivery_point, "KRS1");
    assert.deepEqual(payload.services, [{ code: "INSURANCE", parameter: "10000" }]);
    assert.deepEqual(payload.packages, [{ number: "1", length: 35, width: 35, height: 7, weight: 800 }]);
    return { data: responseTariff };
  };

  try {
    const result = await calculateCdekDelivery({
      inventory: inventory("hoodie"),
      merchandisePrice: 10000,
      cdekMode: "office",
      cdekAddress: { code: "KRS1", city_code: 1 },
    });

    assert.equal(result.deliveryPrice, 687.75);
    assert.equal(result.insurancePrice, 78.75);
    assert.equal(result.office.location.city_code, 44);
    assert.equal(result.office.location.city, "Красноярск");
    assert.equal(result.tariffCode, 136);
    for (const invalid of [
      { delivery_sum: 580 }, { total_sum: null, services: [{ code: "INSURANCE", total_sum: 78.75 }] },
      { total_sum: 609, services: [] }, { total_sum: 687.75, services: [{ code: "INSURANCE", total_sum: "78.75" }] },
      { ...responseTariff, errors: [{ code: "unavailable" }] },
    ]) {
      responseTariff = invalid;
      await assert.rejects(calculateCdekDelivery({ inventory: inventory("hoodie"), merchandisePrice: 10000, cdekMode: "office", cdekAddress: { code: "KRS1" } }), { code: "cdek_tariff_unavailable" });
    }
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
