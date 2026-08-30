import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const acquisitionUi = readFileSync(new URL('../landing/acquisition-ui.js', import.meta.url), 'utf8');
const handoff = readFileSync(new URL('../landing/manage/handoff.js', import.meta.url), 'utf8');
const manageHtml = readFileSync(new URL('../landing/manage/index.html', import.meta.url), 'utf8');
const pagesBuild = readFileSync(new URL('../deploy/build-pages.sh', import.meta.url), 'utf8');
const productionBuild = readFileSync(new URL('../deploy/build-landing.sh', import.meta.url), 'utf8');

test('payment return never treats browser redirect as payment proof', () => {
  assert.match(acquisitionUi, /Переход назад на сайт сам по себе не считается подтверждением оплаты/);
  assert.match(acquisitionUi, /apiUrl\("\/checkout\/return"\)/);
  assert.match(acquisitionUi, /payload\?\.status === "paid"/);
  assert.match(acquisitionUi, /typeof payload\.magicToken === "string"/);
  assert.doesNotMatch(acquisitionUi, /checkout\/status/);
});

test('payment return context stores only the browser checkout credential and local UI context', () => {
  assert.match(acquisitionUi, /safeStorageSet\(CHECKOUT_CONTEXT_KEY, \{\s*checkoutKey,\s*groupId: body\.groupId \?\? state\.groupId,\s*createdAt:/s);
  assert.doesNotMatch(acquisitionUi, /providerPaymentId/);
  assert.doesNotMatch(acquisitionUi, /paymentId/);
  assert.doesNotMatch(acquisitionUi, /orderId/);
  assert.doesNotMatch(acquisitionUi, /runtime-checkout-email/);
});

test('verified paid return opens management through one-time proof without an email round-trip', () => {
  assert.match(acquisitionUi, /window\.location\.replace\(`\.\/manage\/#token=\$\{encodeURIComponent\(payload\.magicToken\)\}`\)/);
  assert.match(acquisitionUi, /initialLinkRequired: payload\.initialLinkRequired === true/);
  assert.match(handoff, /\/management\/recover/);
  assert.match(handoff, /Оплата подтверждена/);
  assert.match(handoff, /initialLinkRequired !== true/);
});

test('management handoff loads before the normal management client', () => {
  const handoffIndex = manageHtml.indexOf('./handoff.js');
  const manageIndex = manageHtml.indexOf('./manage.js');
  assert.ok(handoffIndex >= 0, 'handoff.js must be loaded');
  assert.ok(manageIndex >= 0, 'manage.js must be loaded');
  assert.ok(handoffIndex < manageIndex, 'handoff.js must wrap fetch before manage.js starts');
});

test('deployed landing artifacts use acquisition UI and no longer inject the legacy payment-return script', () => {
  for (const build of [pagesBuild, productionBuild]) {
    assert.match(build, /acquisition-ui\.js/);
    assert.doesNotMatch(build, /payment-return\.js/);
  }
});
