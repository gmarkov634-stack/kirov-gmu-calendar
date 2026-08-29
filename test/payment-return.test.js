import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const paymentReturn = readFileSync(new URL('../landing/payment-return.js', import.meta.url), 'utf8');
const pagesBuild = readFileSync(new URL('../deploy/build-pages.sh', import.meta.url), 'utf8');
const productionBuild = readFileSync(new URL('../deploy/build-landing.sh', import.meta.url), 'utf8');

test('payment return UX never treats redirect as proof of payment', () => {
  assert.match(paymentReturn, /Возврат со страницы ЮKassa сам по себе не подтверждает оплату/);
  assert.match(paymentReturn, /Сервер отдельно проверяет статус платежа у провайдера/);
  assert.match(paymentReturn, /Проверяем оплату/);
  assert.doesNotMatch(paymentReturn, /Оплата подтверждена/);
  assert.doesNotMatch(paymentReturn, /checkout\/status/);
});

test('payment return context stores no email or payment identifiers', () => {
  assert.match(paymentReturn, /sessionStorage\.setItem/);
  assert.match(paymentReturn, /summary/);
  assert.doesNotMatch(paymentReturn, /runtime-checkout-email/);
  assert.doesNotMatch(paymentReturn, /orderId/);
  assert.doesNotMatch(paymentReturn, /paymentId/);
});

test('payment return offers safe management and retry navigation', () => {
  assert.match(paymentReturn, /\.\/manage\//);
  assert.match(paymentReturn, /Повторно оплачивать тот же тариф не нужно/);
  assert.match(paymentReturn, /Вернуться к выбору группы/);
});

test('payment return script is included in deployed landing artifacts', () => {
  assert.match(pagesBuild, /payment-return\.js/);
  assert.match(productionBuild, /payment-return\.js/);
});
