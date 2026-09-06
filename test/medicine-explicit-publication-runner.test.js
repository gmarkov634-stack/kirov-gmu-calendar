import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CASES = [
  {
    script: 'ops/publish-medicine-201-220.mjs',
    streams: ['201-210', '211-220']
  },
  {
    script: 'ops/publish-medicine-301-317.mjs',
    streams: ['301-310', '311-317']
  }
];

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
}

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('legacy medicine publication entrypoints preserve their preflight contract through the shared runner', () => {
  for (const { script, streams } of CASES) {
    const result = run(script, ['--preflight']);
    assert.equal(result.status, 0, `${script} failed:\n${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES\s*$/);

    const summaryText = result.stdout.replace(/\nPREFLIGHT_OK_NO_DATABASE_CHANGES\s*$/, '');
    const summary = JSON.parse(summaryText);
    assert.equal(summary.mode, 'preflight');
    assert.equal(summary.universityId, 'kirov-gmu');
    assert.equal(summary.academicYearId, '2026-2027');
    assert.equal(summary.academicPeriodId, '2026-2027-semester-1');
    assert.deepEqual(summary.streams.map(({ stream }) => stream), streams);
    assert.equal(summary.groupCount, summary.streams.flatMap(({ versions }) => versions).length);
    assert.equal(
      summary.eventCount,
      summary.streams.reduce((sum, { eventCount }) => sum + eventCount, 0)
    );
  }
});

test('legacy medicine publication entrypoints keep rejecting unsupported CLI arguments', () => {
  for (const { script } of CASES) {
    const result = run(script, ['--unexpected']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported arguments: --unexpected/);
  }
});

test('medicine 201-317 stream runner delegates database publication to the shared medicine runtime', async () => {
  const [runner, medicineRuntime] = await Promise.all([
    source('ops/lib/publish-explicit-medicine-streams.mjs'),
    source('ops/lib/publish-medicine-plan.mjs')
  ]);

  assert.match(runner, /applyMedicinePublicationPlan/);
  assert.match(runner, /toCorePublicationQa/);
  assert.match(runner, /streams disagree on shared core evidence/);
  assert.match(runner, /emitResult:\s*false/);
  assert.match(runner, /lecture display prefix is missing from rendered ICS/);
  assert.match(runner, /ЛЕКЦ\./);

  for (const duplicatedApi of [
    'openSqliteRuntimeDatabase',
    'createSqliteScheduleRepository',
    'createReadyScheduleVersion',
    'saveReadySnapshot',
    'publishVersion',
    'PRAGMA integrity_check',
    'SELECT COUNT(*) AS count FROM schedule_versions'
  ]) {
    assert.doesNotMatch(runner, new RegExp(duplicatedApi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(medicineRuntime, /emitResult = true/);
  assert.match(medicineRuntime, /if \(emitResult\) console\.log/);
  assert.match(medicineRuntime, /return output/);
});
