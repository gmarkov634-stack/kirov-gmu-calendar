import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const browserBinding = readFileSync(
  new URL('../landing/trial-browser-binding.js', import.meta.url),
  'utf8'
);
const buildLanding = readFileSync(new URL('../deploy/build-landing.sh', import.meta.url), 'utf8');
const buildPages = readFileSync(new URL('../deploy/build-pages.sh', import.meta.url), 'utf8');

test('trial client persists an opaque browser id and sends it only with trial requests', () => {
  assert.match(browserBinding, /kgmu-calendar:trial-browser-id-v1/);
  assert.match(browserBinding, /localStorage\.getItem/);
  assert.match(browserBinding, /localStorage\.setItem/);
  assert.match(browserBinding, /crypto\?\.randomUUID|crypto\.randomUUID|globalThis\.crypto\?\.randomUUID/);
  assert.match(browserBinding, /getRandomValues/);
  assert.match(browserBinding, /browserTrialId/);
  assert.match(browserBinding, /pathname\.endsWith\("\/trial"\)/);
});

test('trial browser binding does not use browser fingerprinting or IP-derived identity', () => {
  assert.doesNotMatch(browserBinding, /canvas/i);
  assert.doesNotMatch(browserBinding, /webgl/i);
  assert.doesNotMatch(browserBinding, /userAgent/i);
  assert.doesNotMatch(browserBinding, /hardwareConcurrency/i);
  assert.doesNotMatch(browserBinding, /deviceMemory/i);
  assert.doesNotMatch(browserBinding, /x-forwarded-for/i);
});

test('trial client has a one-release compatibility retry for the pre-binding core', () => {
  assert.match(browserBinding, /response\.status !== 400/);
  assert.match(browserBinding, /invalid_trial_request/);
  assert.match(browserBinding, /delete legacyBody\.browserTrialId/);
});

test('both deploy artifacts load the trial browser binding before the landing module', () => {
  assert.match(buildLanding, /trial-browser-binding\.js/);
  assert.match(buildPages, /trial-browser-binding\.js/);
});
