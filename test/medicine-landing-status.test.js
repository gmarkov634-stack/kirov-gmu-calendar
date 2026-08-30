import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pages marks published medicine groups 101-110 and 201-220 as available', async () => {
  const status = await read('landing/availability-status.js');
  const pagesConfig = await read('deploy/runtime-config.pages.js');
  const builder = await read('deploy/build-pages.sh');

  for (let group = 101; group <= 110; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  for (let group = 201; group <= 220; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  assert.doesNotMatch(status, /"111"|"112"|"113"|"114"|"115"|"116"|"117"|"118"|"119"|"120"/);
  assert.match(status, /1–2 курс доступны/);
  assert.match(status, /Группы 101–110 и 201–220/);
  assert.match(status, /Группы 201–220 доступны/);
  assert.match(status, /проверенным официальным расписаниям КГМУ/);
  assert.match(status, /7-дневную бесплатную пробу/);
  assert.match(builder, /availability-status\.js/);
  assert.match(pagesConfig, /trialEnabled:\s*true/);
  assert.match(pagesConfig, /checkoutEnabled:\s*true/);
});
