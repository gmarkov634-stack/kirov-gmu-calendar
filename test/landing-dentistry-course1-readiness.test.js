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

const groups = ['191', '192', '193', '194'];
const facultatives = [
  { facultativeId: 'kgmu-2026-2027-s1-dentistry-facultative-biology', label: 'Актуальные вопросы биологии' },
  { facultativeId: 'kgmu-2026-2027-s1-dentistry-facultative-russian', label: 'Русский язык и культура речи' },
  { facultativeId: 'kgmu-2026-2027-s1-dentistry-facultative-physics', label: 'Физика' },
  { facultativeId: 'kgmu-2026-2027-s1-dentistry-facultative-math', label: 'Математика' }
];

test('Dentistry course 1 is fail-closed while course 4 remains exposed', async () => {
  const source = await read('landing/availability-status.js');
  for (const groupId of groups) assert.match(source, new RegExp(`"${groupId}"`));
  assert.match(source, /program === "Стоматология"/);
  assert.match(source, /"4 курс доступен"/);
  assert.match(source, /"Группы 491–494 опубликованы · группы 191–194 проходят проверку новой официальной версии"/);
  assert.match(source, /isDentistry/);
  assert.match(source, /"Группы 191–194 — проверка новой версии"/);
  assert.match(source, /Стоматология: 4 курс опубликован/);
  assert.doesNotMatch(source, /"191", "192", "193", "194",/);
});

test('Pages and production configs expose exactly the Dentistry course 1 facultatives for all four groups', async () => {
  for (const configPath of ['deploy/runtime-config.pages.js', 'deploy/runtime-config.production.js']) {
    const config = evaluateRuntimeConfig(await read(configPath));
    const catalog = config.facultativeCatalog?.['2026-2027-semester-1'];
    assert.ok(catalog, configPath);
    for (const groupId of groups) {
      assert.deepEqual(
        Array.from(catalog[groupId], (item) => ({ facultativeId: item.facultativeId, label: item.label })),
        facultatives,
        `${configPath}:${groupId}`
      );
    }
    assert.equal(config.academicPeriodLabels?.['2026-2027-semester-1'], '1 семестр');
  }
});

test('Dentistry course 1 historical publication evidence cannot authorize the current source revision', async () => {
  const [source, evidence, qa] = await Promise.all([
    read('fixtures/2026-2027-semester-1/dentistry-191-194.source.json').then(JSON.parse),
    read('qa/2026-2027-semester-1/dentistry-191-194.publication-evidence.json').then(JSON.parse),
    read('qa/2026-2027-semester-1/dentistry-191-194.qa-report.json').then(JSON.parse)
  ]);
  assert.equal(source.lifecycle.publicationAllowed, true);
  assert.equal(evidence.lifecycleStatus, 'SUPERSEDED_SOURCE_REVISION');
  assert.equal(evidence.publicationAllowed, false);
  assert.equal(evidence.currentSourceSha256, source.source.sha256);
  assert.notEqual(evidence.sourceSha256, source.source.sha256);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.readyForScheduleVersion, true);
  assert.equal(qa.publicationAllowed, true);
  assert.equal(qa.compatibilityGate.status, 'pass');
});

test('Dentistry landing preparation does not change trial or checkout policy', async () => {
  const pages = evaluateRuntimeConfig(await read('deploy/runtime-config.pages.js'));
  const production = evaluateRuntimeConfig(await read('deploy/runtime-config.production.js'));
  assert.equal(pages.trialEnabled, true);
  assert.equal(pages.checkoutEnabled, true);
  assert.equal(production.trialEnabled, true);
  assert.equal(production.checkoutEnabled, false);
});
