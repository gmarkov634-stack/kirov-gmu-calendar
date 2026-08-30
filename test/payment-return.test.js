import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const acquisitionUi = readFileSync(new URL('../landing/acquisition-ui.js', import.meta.url), 'utf8');
const handoff = readFileSync(new URL('../landing/manage/handoff.js', import.meta.url), 'utf8');
const manageHtml = readFileSync(new URL('../landing/manage/index.html', import.meta.url), 'utf8');
const trialCss = readFileSync(new URL('../landing/assets/trial.css', import.meta.url), 'utf8');
const manageCss = readFileSync(new URL('../landing/manage/manage.css', import.meta.url), 'utf8');
const pagesBuild = readFileSync(new URL('../deploy/build-pages.sh', import.meta.url), 'utf8');
const productionBuild = readFileSync(new URL('../deploy/build-landing.sh', import.meta.url), 'utf8');

test('acquisition personalization is applied before trial and checkout', () => {
  assert.match(acquisitionUi, /Персонализация до подключения/);
  assert.match(acquisitionUi, /Факультативы/);
  assert.match(acquisitionUi, /Напоминания/);
  assert.match(acquisitionUi, /body\.preferences = clonePreferences\(\)/);
  assert.match(acquisitionUi, /const isTrial =/);
  assert.match(acquisitionUi, /const isCheckout =/);
});

test('trial result exposes direct iPhone and Google Calendar actions', () => {
  assert.match(acquisitionUi, /return `webcal:\/\/\$\{parsed\.host\}\$\{parsed\.pathname\}\$\{parsed\.search\}\$\{parsed\.hash\}`;/);
  assert.doesNotMatch(acquisitionUi, /parsed\.protocol\s*=\s*"webcal:"/);
  assert.match(acquisitionUi, /Добавить в iPhone/);
  assert.match(acquisitionUi, /Скопировать для Google Calendar/);
});

test('facultative checkboxes stay compact and email fields are touch-friendly', () => {
  assert.match(trialCss, /input\[type="checkbox"\][^\n]*\{width:18px;height:18px/);
  assert.match(trialCss, /input\[type="email"\][^\n]*\{box-sizing:border-box;width:100%;min-height:58px/);
  assert.match(manageCss, /\.facultative-choice input\[type="checkbox"\][\s\S]*?width: 18px;[\s\S]*?height: 18px;/);
  assert.match(manageCss, /\.manage-form input\[type="email"\][\s\S]*?min-height: 58px;/);
});

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

test('management calendar actions do not duplicate the Google copy control', () => {
  assert.match(handoff, /output\.dataset\.calendarActionsReady = "true"/);
  assert.match(handoff, /calendarActions\(input\.value, \{ includeGoogle: !existingCopy \}\)/);
  assert.match(handoff, /existingCopy\.textContent = "Скопировать для Google Calendar"/);
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
