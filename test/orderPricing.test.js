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
    patronusPrice: 8500, carPrice: 6500, petFacePrice: 6000,
    packageWidth: 30, packageHeight: 20, packageLength: 3, packageWeight: 300,
  },
  svitshot: {
    code: "svitshot", patronusLimit: 5,
    patronusPrice: 9500, carPrice: 8000, petFacePrice: 7000,
    packageWidth: 35, packageHeight: 35, packageLength: 7, packageWeight: 800,
  },
  hoodie: {
    code: "hoodie", patronusLimit: 5,
    patronusPrice: 10000, carPrice: 8500, petFacePrice: 8000,
    packageWidth: 35, packageHeight: 35, packageLength: 7, packageWeight: 800,
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
      Car: 8500,
      petFace: 12000,
    }
  );
});

test("расчёт использует профиль изделия и серверные доплаты без скрытых констант", () => {
  const changedConfig = {
    additional: { ...pricingConfig.additional, Patronus: 777 },
  };

  assert.equal(calculateMerchandisePrice({
    inventory: inventory("hoodie", { carPrice: 12345 }),
    embroideryType: "Car",
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
      carPrice: 4321,
    },
  };
  assert.equal(calculateMerchandisePrice({
    inventory: arbitraryInventory,
    embroideryType: "Car",
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
      data: [{ code: "KRS1", location: { city_code: 44, address: "Настоящий адрес" } }],
    };
  };
  axios.post = async (url, payload) => {
    if (url.endsWith("/oauth/token")) {
      return { data: { access_token: "test-token", expires_in: 3600 } };
    }

    assert.equal(payload.from_location.code, 278);
    assert.equal(payload.to_location.code, 44);
    assert.equal(payload.packages[0].weight, 800);
    return {
      data: {
        tariff_codes: [
          { tariff_code: 999, delivery_sum: 1 },
          { tariff_code: 136, delivery_sum: 742.4 },
        ],
      },
    };
  };

  try {
    const result = await calculateCdekDelivery({
      inventory: inventory("hoodie"),
      cdekMode: "office",
      cdekAddress: { code: "KRS1", city_code: 1 },
    });

    assert.equal(result.deliveryPrice, 742);
    assert.equal(result.office.location.city_code, 44);
    assert.equal(result.tariffCode, 136);
  } finally {
    axios.get = originalGet;
    axios.post = originalPost;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
