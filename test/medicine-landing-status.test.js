import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pages marks medicine groups 101-120 through 601-616 as published and enables trial plus checkout', async () => {
  const status = await read('landing/availability-status.js');
  const pagesConfig = await read('deploy/runtime-config.pages.js');
  const builder = await read('deploy/build-pages.sh');

  for (let group = 101; group <= 120; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  for (let group = 201; group <= 220; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  for (let group = 301; group <= 317; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  for (let group = 401; group <= 416; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  for (let group = 501; group <= 516; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  for (let group = 601; group <= 616; group += 1) {
    assert.match(status, new RegExp(`\\"${group}\\"`));
  }
  assert.doesNotMatch(status, /\"318\"/);
  assert.doesNotMatch(status, /\"517\"/);
  assert.doesNotMatch(status, /\"617\"/);
  assert.match(status, /1–6 курсы доступны/);
  assert.match(status, /Группы 101–120, 201–220, 301–317, 401–416, 501–516 и 601–616/);
  assert.match(status, /Группы 201–220 доступны/);
  assert.match(status, /Группы 301–317 доступны/);
  assert.match(status, /Группы 401–416 доступны/);
  assert.match(status, /Группы 501–516 доступны/);
  assert.match(status, /Группы 601–616 доступны/);
  assert.match(status, /проверенным официальным расписаниям КГМУ/);
  assert.match(status, /7-дневную бесплатную пробу/);
  assert.match(builder, /availability-status\.js/);
  assert.match(pagesConfig, /trialEnabled:\s*true/);
  assert.match(pagesConfig, /checkoutEnabled:\s*true/);
});

test('medicine groups 101-120 receive the first-year facultative catalog on both landing targets', async () => {
  const pagesConfig = await read('deploy/runtime-config.pages.js');
  const productionConfig = await read('deploy/runtime-config.production.js');

  for (const config of [pagesConfig, productionConfig]) {
    assert.match(config, /const MEDICINE_1_FACULTATIVES/);
    assert.match(config, /const MEDICINE_1_FACULTATIVE_CATALOG/);
    for (let group = 101; group <= 120; group += 1) {
      assert.match(config, new RegExp(`\\"${group}\\"`));
    }
    for (const facultativeId of [
      'kgmu-2026-2027-s1-medicine-facultative-biology',
      'kgmu-2026-2027-s1-medicine-facultative-chemistry',
      'kgmu-2026-2027-s1-medicine-facultative-physics',
      'kgmu-2026-2027-s1-medicine-facultative-math',
      'kgmu-2026-2027-s1-medicine-facultative-russian'
    ]) {
      assert.match(config, new RegExp(facultativeId));
    }
  }
});
