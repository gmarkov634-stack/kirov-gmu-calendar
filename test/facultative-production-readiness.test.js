import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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

test('replacement preflight identifies the exact old and new medicine candidates without DB changes', async () => {
  const script = new URL('../ops/publish-medicine-101-110.mjs', import.meta.url);
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight', '--replace-existing']);
  assert.equal(stderr, '');
  assert.match(stdout, /"mode": "preflight-replacement"/);
  assert.match(stdout, /"eventCount": 4349/);
  assert.match(stdout, /sha256:5282de1dcec279ac4d035d55ea57d293d8ed0294ecc1cb0e3446e7a4e7a3f20a/);
  assert.match(stdout, /kgmu-2026-2027-s1-medicine-101-5282de1dcec279ac/);
  assert.match(stdout, /kgmu-2026-2027-s1-medicine-101-26b6a9b1d2e6c234/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});

test('replacement runner fails closed around the expected source and preserves superseded versions', async () => {
  const script = await read('ops/publish-medicine-101-110.mjs');
  assert.match(script, /current\.scheduleVersion\.versionId !== previousVersionId/);
  assert.match(script, /current published source does not match the approved previous candidate/);
  assert.match(script, /eventSetDigest\(current\.events\) !== expectedPreviousDigest/);
  assert.match(script, /previousRow\.status !== 'superseded'/);
  assert.match(script, /must have exactly one published version/);
  assert.match(script, /PRODUCTION_SCHEDULES_REPLACED_AND_VERIFIED/);
  assert.doesNotMatch(script, /DELETE FROM schedule_versions|DELETE FROM schedule_events/);
});

test('Pages facultative catalog exactly mirrors the source-backed medicine fixture for groups 101-110', async () => {
  const fixture = await readJson('fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json');
  const config = evaluateRuntimeConfig(await read('deploy/runtime-config.pages.js'));
  const periodCatalog = config.facultativeCatalog?.[fixture.academicPeriodId];
  assert.ok(periodCatalog);
  assert.equal(config.academicPeriodLabels?.[fixture.academicPeriodId], '1 семестр');

  const expectedDefinitions = fixture.items.map((item) => ({
    facultativeId: item.facultativeId,
    label: item.discipline
  }));
  for (const groupId of fixture.groupIds) {
    assert.deepEqual(
      Array.from(periodCatalog[groupId], (item) => ({
        facultativeId: item.facultativeId,
        label: item.label
      })),
      expectedDefinitions,
      groupId
    );
  }
  assert.deepEqual(Object.keys(periodCatalog).sort(), [...fixture.groupIds].sort());
});

test('management UI treats an absent facultative preference as off', async () => {
  const manage = await read('landing/manage/manage.js');
  assert.match(manage, /input\.checked = current\[definition\.facultativeId\] === true;/);
  assert.doesNotMatch(manage, /input\.checked = current\[definition\.facultativeId\] !== false;/);
});
