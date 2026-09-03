import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function evaluateRuntimeConfig(source) {
  const context = { window: {}, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.window.KGMU_CALENDAR_CONFIG;
}

const groups = ['491', '492', '493', '494'];
const digest = 'sha256:73cb833fb0f175a449e488c0125153e94f5528f5eebd0d46f5dab7719341ac15';

test('Dentistry course 4 is prepared as published landing availability only for groups 491-494', async () => {
  const source = await read('landing/availability-status.js');
  for (const groupId of groups) assert.match(source, new RegExp(`"${groupId}"`));
  assert.match(source, /program === "Стоматология"/);
  assert.match(source, /"1 и 4 курсы доступны"/);
  assert.match(source, /"Группы 191–194 и 491–494 · опубликованы и доступны для 7-дневной бесплатной пробы"/);
  assert.match(source, /isDentistry/);
  assert.match(source, /title === "4 курс"/);
  assert.match(source, /"Группы 491–494 доступны"/);
  assert.match(source, /Стоматология: 1 и 4 курсы опубликованы/);
});

test('Dentistry course 4 landing exposure is bound to the exact publication evidence', async () => {
  const evidence = JSON.parse(await read('qa/2026-2027-semester-1/dentistry-491-494.publication-evidence.json'));
  assert.equal(evidence.schema, 'kgmu-dentistry-publication-evidence-v1');
  assert.equal(evidence.sourceSha256, '2e945ca99ec75bfbe7f98402d0752ebe96afbd12780d29c7f5cdf32f7e22b265');
  assert.equal(evidence.candidateDigest, digest);
  assert.equal(evidence.eventSetDigest, digest);
  assert.equal(evidence.eventCount, 531);
  assert.deepEqual(evidence.groupEventCounts, { '491': 133, '492': 133, '493': 133, '494': 132 });
  assert.deepEqual(evidence.groupDateOnlyEventCounts, { '491': 12, '492': 12, '493': 12, '494': 12 });
  assert.deepEqual(evidence.facultativeIds, []);
});

test('Dentistry course 4 landing preparation does not change trial or checkout policy', async () => {
  const pages = evaluateRuntimeConfig(await read('deploy/runtime-config.pages.js'));
  const production = evaluateRuntimeConfig(await read('deploy/runtime-config.production.js'));
  assert.equal(pages.trialEnabled, true);
  assert.equal(pages.checkoutEnabled, true);
  assert.equal(production.trialEnabled, true);
  assert.equal(production.checkoutEnabled, false);
});
