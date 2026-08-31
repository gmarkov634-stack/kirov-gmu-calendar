import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

function evaluateRuntimeConfig(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.KGMU_CALENDAR_CONFIG;
}

test('replacement preflight identifies the current production and corrected medicine candidates without DB changes', async () => {
  const script = fileURLToPath(new URL('../ops/publish-medicine-101-110.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight', '--replace-existing']);
  assert.equal(stderr, '');
  assert.match(stdout, /"mode": "preflight-replacement"/);
  assert.match(stdout, /"eventCount": 4349/);
  assert.match(stdout, /sha256:d0f1ea53fc7af88f7f4a6f402462a0a535fb66042508b7326326212ef84874c5/);
  assert.match(stdout, /kgmu-2026-2027-s1-medicine-101-d0f1ea53fc7af88f/);
  assert.match(stdout, /kgmu-2026-2027-s1-medicine-101-1d56b5b52c6eb6b7/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('replacement runner reconstructs and verifies the exact current production source before mutation', async () => {
  const script = await read('ops/publish-medicine-101-110.mjs');
  assert.match(script, /async function verifyReplacementSources/);
  assert.match(script, /await verifyReplacementSources\(\{ repository, database, plan \}\)/);
  assert.match(script, /GROUP_102_LATIN_CORRECTION/);
  assert.match(script, /sourceLocator: '1 леч\.1!C36#s1'/);
  assert.match(script, /targetDate: '2026-09-02'/);
  assert.match(script, /targetStartTime: '08:40'/);
  assert.match(script, /targetEndTime: '10:10'/);
  assert.match(script, /previousDate: '2026-09-02'/);
  assert.match(script, /previousStartTime: '14:30'/);
  assert.match(script, /previousEndTime: '16:00'/);
  assert.match(script, /replacementCount !== 1/);
  assert.match(script, /replacement source is missing/);
  assert.match(script, /current\.scheduleVersion\.versionId !== previousVersionId/);
  assert.match(script, /current published source does not match the approved previous candidate/);
  assert.match(script, /eventSetDigest\(current\.events\) !== expectedPreviousDigest/);
  assert.match(script, /previousRow\.status !== 'superseded'/);
  assert.match(script, /must have exactly one published version/);
  assert.match(script, /PRODUCTION_SCHEDULES_REPLACED_AND_VERIFIED/);
  assert.doesNotMatch(script, /DELETE FROM schedule_versions|DELETE FROM schedule_events/);
});

test('deployment facultative catalogs exactly mirror both source-backed medicine first-year fixtures', async () => {
  const fixtures = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-111-120.facultatives.json')
  ]);
  const definitions = fixtures.map((fixture) => fixture.items.map((item) => ({
    facultativeId: item.facultativeId,
    label: item.discipline
  })));

  assert.equal(fixtures[0].academicPeriodId, fixtures[1].academicPeriodId);
  assert.deepEqual(definitions[0], definitions[1]);
  const expectedGroupIds = fixtures.flatMap((fixture) => fixture.groupIds);

  for (const configPath of ['deploy/runtime-config.pages.js', 'deploy/runtime-config.production.js']) {
    const config = evaluateRuntimeConfig(await read(configPath));
    const periodCatalog = config.facultativeCatalog?.[fixtures[0].academicPeriodId];
    assert.ok(periodCatalog, configPath);
    assert.equal(config.academicPeriodLabels?.[fixtures[0].academicPeriodId], '1 семестр', configPath);

    for (const fixture of fixtures) {
      for (const groupId of fixture.groupIds) {
        assert.deepEqual(
          Array.from(periodCatalog[groupId], (item) => ({
            facultativeId: item.facultativeId,
            label: item.label
          })),
          definitions[0],
          `${configPath}:${groupId}`
        );
      }
    }
    assert.deepEqual(Object.keys(periodCatalog).sort(), [...expectedGroupIds].sort(), configPath);
  }
});

test('management UI treats an absent facultative preference as off', async () => {
  const manage = await read('landing/manage/manage.js');
  assert.match(manage, /input\.checked = current\[definition\.facultativeId\] === true;/);
  assert.doesNotMatch(manage, /input\.checked = current\[definition\.facultativeId\] !== false;/);
});
