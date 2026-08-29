import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pages marks medicine groups 101-110 as published, enables trial, and keeps checkout closed', async () => {
  const status = await read('landing/availability-status.js');
  const pagesConfig = await read('deploy/runtime-config.pages.js');
  const builder = await read('deploy/build-pages.sh');

  for (let group = 101; group <= 110; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  assert.doesNotMatch(status, /"111"|"112"|"113"|"114"|"115"|"116"|"117"|"118"|"119"|"120"/);
  assert.match(status, /Группы 101–110 доступны/);
  assert.match(status, /27\.08\.2026/);
  assert.match(status, /7-дневную бесплатную пробу/);
  assert.match(builder, /availability-status\.js/);
  assert.match(pagesConfig, /trialEnabled:\s*true/);
  assert.match(pagesConfig, /checkoutEnabled:\s*false/);
});
