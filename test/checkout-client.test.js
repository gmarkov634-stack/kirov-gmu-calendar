import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../landing/app.js', import.meta.url), 'utf8');
const pagesConfig = readFileSync(
  new URL('../deploy/runtime-config.pages.js', import.meta.url),
  'utf8'
);
const productionConfig = readFileSync(
  new URL('../deploy/runtime-config.production.js', import.meta.url),
  'utf8'
);

test('landing checkout uses server-owned product codes and high-entropy idempotency', () => {
  assert.match(app, /productCode: selectedProductCode/);
  assert.match(app, /"Idempotency-Key": checkoutKey/);
  assert.match(app, /crypto\?\.randomUUID/);
  assert.match(app, /getRandomValues/);
  assert.match(app, /apiUrl\("\/checkout"\)/);
  assert.doesNotMatch(app, /checkout\/status/);
  assert.doesNotMatch(app, /orderId=/);
});

test('landing never treats provider return as payment proof', () => {
  assert.match(app, /Возврат на сайт сам по себе не подтверждает оплату/);
  assert.match(app, /Доступ активируется только после серверного подтверждения ЮKassa/);
  assert.match(app, /confirmationUrl\.protocol !== "https:"/);
  assert.match(app, /window\.location\.assign\(confirmationUrl\.toString\(\)\)/);
});

test('GitHub Pages checkout is enabled only after production payment E2E while trial stays live', () => {
  assert.match(pagesConfig, /checkoutEnabled: true/);
  assert.match(pagesConfig, /trialEnabled: true/);
  assert.match(pagesConfig, /managementEnabled: true/);
  assert.match(pagesConfig, /annualSalesCutoff: "2026-12-31T21:00:00\.000Z"/);

  assert.match(productionConfig, /checkoutEnabled: false/);
  assert.match(productionConfig, /annualSalesCutoff: "2026-12-31T21:00:00\.000Z"/);
});

test('annual plan is hidden by the versioned sales cutoff while server remains authoritative', () => {
  assert.match(app, /function annualOfferIsVisible\(\)/);
  assert.match(app, /Date\.now\(\) < cutoff\.getTime\(\)/);
  assert.match(app, /academic-year-access/);
  assert.match(app, /checkout_unavailable/);
});
