import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pages marks medicine groups 101-120 as published and enables trial plus checkout', async () => {
  const status = await read('landing/availability-status.js');
  const pagesConfig = await read('deploy/runtime-config.pages.js');
  const builder = await read('deploy/build-pages.sh');

  for (let group = 101; group <= 120; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  assert.doesNotMatch(status, /"201"|"202"|"203"|"204"|"205"|"206"|"207"|"208"|"209"|"210"/);
  assert.match(status, /Группы 101–120 доступны/);
  assert.match(status, /Группы 101–120 опубликованы по проверенным официальным расписаниям/);
  assert.match(status, /7-дневную бесплатную пробу/);
  assert.match(builder, /availability-status\.js/);
  assert.match(pagesConfig, /trialEnabled:\s*true/);
  assert.match(pagesConfig, /checkoutEnabled:\s*true/);
});
