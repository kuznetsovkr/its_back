const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { issueCitySelection, verifyCitySelection, CITY_TTL_MS } = require("../lib/deliveryCity");
const { createCityService, normalizeCitySuggestion } = require("../services/deliveryCities");
const { createDeliveryCityRouter } = require("../routes/deliveryCityRoutes");
process.env.ORDER_ACCESS_SECRET = "fixture-delivery-cities-signing-secret-".repeat(3);
process.env.DADATA_API_KEY = "fixture-not-a-real-key";

const id = "11111111-1111-4111-8111-111111111111";
const suggestion = (changes = {}) => ({ value: "Красноярский край, г Красноярск", data: {
  fias_level: "4", city_fias_id: id, city: "Красноярск", region_iso_code: "RU-KYA", country_iso_code: "RU",
  geo_lon: "92.868", geo_lat: "56.0106", ...changes,
} });
const city = () => normalizeCitySuggestion(suggestion(), true);

test("city receipt is purpose-bound, expires at 30 days and cannot be forged", () => {
  const now = Date.now();
  const selected = issueCitySelection(city(), now);
  assert.equal(verifyCitySelection(selected.token, now).name, "Красноярск");
  assert.equal(verifyCitySelection(selected.token, now + CITY_TTL_MS - 1).pickup, true);
  assert.throws(() => verifyCitySelection(selected.token, now + CITY_TTL_MS));
  const [version, body, signature] = selected.token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...city(), name: "Москва", pickup: true, expiresAt: selected.expiresAt })).toString("base64url");
  for (const invalid of [`${version}.${forged}.${signature}`, `v1.${body}.${signature}`, selected.token + ".extra", "", "x".repeat(2049)]) {
    assert.throws(() => verifyCitySelection(invalid, now));
  }
});

test("city normalization distinguishes cities from settlements and rejects addresses or missing coordinates", () => {
  assert.equal(city().pickup, true);
  assert.equal(normalizeCitySuggestion(suggestion({ region_iso_code: "RU-MOW" })).pickup, false);
  assert.equal(normalizeCitySuggestion(suggestion({ country_iso_code: "KZ" })), null);
  assert.equal(normalizeCitySuggestion(suggestion({ fias_level: "7", street: "Мира" })), null);
  assert.equal(normalizeCitySuggestion(suggestion({ geo_lon: null }), true), null);
  assert.equal(normalizeCitySuggestion(suggestion({ geo_lon: "999" }), true), null);
  const settlement = normalizeCitySuggestion(suggestion({ fias_level: "6", settlement_fias_id: id, settlement: "Красноярск" }));
  assert.equal(settlement.pickup, false);
  const federalCity = suggestion({ fias_level: "1", region_fias_id: id, region_type: "г", city: "Москва", region_iso_code: "RU-MOW" });
  assert.equal(normalizeCitySuggestion(federalCity, true).name, "Москва");
  assert.equal(normalizeCitySuggestion(federalCity, true).pickup, false);
  assert.equal(normalizeCitySuggestion(suggestion({ fias_level: "1", region_type: "край" })), null);
});

test("DaData lookup is bounded, cached, deduplicated and resolves by ID instead of trusting the supplied label", async () => {
  const calls = [];
  const service = createCityService({ post: async (...args) => {
    calls.push(args); return { data: { suggestions: [suggestion()] } };
  } });
  assert.deepEqual(await service.suggest("Красноярск"), [{ id, name: "Красноярск", label: "Красноярский край, г Красноярск" }]);
  await service.suggest("КРАСНОЯРСК");
  const [one, two] = await Promise.all([service.resolve(id), service.resolve(id)]);
  assert.equal(one.id, two.id); assert.ok(one.token); assert.equal(calls.length, 2);
  assert.equal(calls[0][1].count, 7);
  assert.equal(calls[0][1].to_bound.value, "settlement");
  assert.equal(calls[1][1].query, id);
  assert.equal(calls[0][2].timeout, 7000);
  await assert.rejects(() => service.resolve("https://evil.example"));
  assert.equal(calls.length, 2);
  const failed = createCityService({ post: async () => { throw new Error("upstream config/token must not be exposed"); } });
  await assert.rejects(() => failed.resolve(id), error => error.statusCode === 503 && !error.message.includes("token"));
});

test("an office city is taken from server-resolved CDEK data, independently of DaData and client coordinates", async () => {
  const service = createCityService({ getOffice: async code => ({ cityCode: 278, office: { code, location: {
    country_code: "RU", city: "Красноярск", region: "Красноярский край", longitude: 92.87, latitude: 56.01,
  } } }) });
  const selected = await service.office("KRS1");
  assert.equal(selected.id, "cdek:278"); assert.equal(selected.pickup, true);
  assert.equal(verifyCitySelection(selected.token).longitude, 92.87);
});

test("city routes reject untrusted origins, arbitrary fields and unrestricted requests, then rate-limit a client", async t => {
  const oldMode = process.env.NODE_ENV; const oldOrigins = process.env.ALLOWED_PUBLIC_ORIGINS;
  process.env.NODE_ENV = "production"; process.env.ALLOWED_PUBLIC_ORIGINS = "https://stage.its-site.ru";
  const calls = [];
  const app = express(); app.use(express.json());
  app.use("/cities", createDeliveryCityRouter({ suggest: async query => { calls.push(query); return []; }, resolve: async () => city(), office: async () => city() }));
  const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(async () => {
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (oldOrigins === undefined) delete process.env.ALLOWED_PUBLIC_ORIGINS; else process.env.ALLOWED_PUBLIC_ORIGINS = oldOrigins;
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/cities`;
  const send = (path, body, origin = "https://stage.its-site.ru") => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  });
  assert.equal((await send("/suggest", { query: "Москва" }, "https://evil.example")).status, 403);
  assert.equal((await send("/suggest", { query: "М" })).status, 400);
  assert.equal((await send("/suggest", { query: "Москва", url: "https://evil.example" })).status, 400);
  assert.equal((await send("/office", { officeCode: "../secret" })).status, 400);
  const response = await send("/suggest", { query: "Москва" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  let limited = false;
  for (let index = 0; index < 121; index++) {
    const result = await send("/suggest", { query: "Москва" });
    if (result.status === 429) { limited = true; assert.ok(result.headers.get("retry-after")); break; }
  }
  assert.equal(limited, true);
});
