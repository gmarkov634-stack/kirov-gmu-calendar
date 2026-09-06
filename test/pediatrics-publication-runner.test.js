import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CASES = [
  {
    script: 'ops/publish-pediatrics-431-436.mjs',
    candidateDigest: 'sha256:56324602152102118f29829f4ceb99247e6d0c48c873a077441db4e615636ecd',
    eventCount: 768,
    firstGroupId: '431',
    firstVersionId: 'kgmu-2026-2027-s1-pediatrics-431-5632460215210211'
  },
  {
    script: 'ops/publish-pediatrics-531-537.mjs',
    candidateDigest: 'sha256:62811141f1183c303ac854ea58012085bd2e15bf9b873148e31bb2f7fb49eb2a',
    eventCount: 910,
    firstGroupId: '531',
    firstVersionId: 'kgmu-2026-2027-s1-pediatrics-531-62811141f1183c30'
  }
];

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
}

test('pediatrics publication entrypoints preserve their approved preflight contracts', () => {
  for (const fixture of CASES) {
    const result = run(fixture.script, ['--preflight']);
    assert.equal(result.status, 0, `${fixture.script} failed:\n${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES\s*$/);

    const summaryText = result.stdout.replace(/\nPREFLIGHT_OK_NO_DATABASE_CHANGES\s*$/, '');
    const summary = JSON.parse(summaryText);
    assert.equal(summary.mode, 'preflight');
    assert.equal(summary.universityId, 'kirov-gmu');
    assert.equal(summary.programId, 'pediatrics');
    assert.equal(summary.academicYearId, '2026-2027');
    assert.equal(summary.academicPeriodId, '2026-2027-semester-1');
    assert.equal(summary.candidateDigest, fixture.candidateDigest);
    assert.equal(summary.eventCount, fixture.eventCount);
    assert.ok(Array.isArray(summary.versions));
    assert.ok(summary.versions.length > 0);
    assert.equal(summary.versions[0].groupId, fixture.firstGroupId);
    assert.equal(summary.versions[0].versionId, fixture.firstVersionId);
  }
});

test('pediatrics publication entrypoints keep rejecting unsupported CLI arguments', () => {
  for (const { script } of CASES) {
    const result = run(script, ['--unexpected']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported arguments: --unexpected/);
  }
});
