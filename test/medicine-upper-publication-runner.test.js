import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CASES = [
  {
    script: 'ops/publish-medicine-401-416.mjs',
    groups: Array.from({ length: 16 }, (_, index) => String(401 + index)),
    sourceSha256: 'fb79b4c7b08b8f85bd2f238f2190404ea5eae01ab2be47339985272b565ead6b',
    candidateDigest: 'sha256:a38c8269bfd22ea511e9a91fa433dc0c5ae073defcd9722d08c9f6afb2511f1f',
    eventCount: 2310,
    expectedGroupEventCounts: Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => {
        const groupId = String(401 + index);
        return [groupId, Number(groupId) <= 410 ? 144 : 145];
      })
    )
  },
  {
    script: 'ops/publish-medicine-501-516.mjs',
    groups: Array.from({ length: 16 }, (_, index) => String(501 + index)),
    sourceSha256: '43ecb37de9db7ba69153c8514f62de0b058e51c2032e0ee320b117378a740c62',
    candidateDigest: 'sha256:369dbe3d7e0aa5709e06ba0ab0ed1c079d0ec88f89216fe869cbc331ac60f7a1',
    eventCount: 2400,
    expectedGroupEventCounts: null
  },
  {
    script: 'ops/publish-medicine-601-616.mjs',
    groups: Array.from({ length: 16 }, (_, index) => String(601 + index)),
    sourceSha256: '0b5c4a06fd45e50bdaf28586fcb3f4bddade4efe514bc54dd84c359aa04fcb23',
    candidateDigest: 'sha256:4126d3adfeb289ee5e47b27a55960d748ee4aa596b227ba4922f40bf1b5b069c',
    eventCount: 1456,
    expectedGroupEventCounts: null
  }
];

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
}

test('upper-course medicine publication entrypoints preserve their approved preflight contracts', () => {
  for (const fixture of CASES) {
    const result = run(fixture.script, ['--preflight']);
    assert.equal(result.status, 0, `${fixture.script} failed:\n${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES\s*$/);

    const summaryText = result.stdout.replace(/\nPREFLIGHT_OK_NO_DATABASE_CHANGES\s*$/, '');
    const summary = JSON.parse(summaryText);
    assert.equal(summary.mode, 'preflight');
    assert.equal(summary.universityId, 'kirov-gmu');
    assert.equal(summary.academicYearId, '2026-2027');
    assert.equal(summary.academicPeriodId, '2026-2027-semester-1');
    assert.deepEqual(summary.groups, fixture.groups);
    assert.equal(summary.sourceSha256, fixture.sourceSha256);
    assert.equal(summary.candidateDigest, fixture.candidateDigest);
    assert.equal(summary.versionSuffix, fixture.candidateDigest.replace('sha256:', '').slice(0, 16));
    assert.equal(summary.groupCount, fixture.groups.length);
    assert.equal(summary.eventCount, fixture.eventCount);

    if (fixture.expectedGroupEventCounts) {
      assert.deepEqual(summary.groupEventCounts, fixture.expectedGroupEventCounts);
    } else {
      assert.equal(Object.hasOwn(summary, 'groupEventCounts'), false);
    }
  }
});

test('upper-course medicine publication entrypoints keep rejecting unsupported CLI arguments', () => {
  for (const { script } of CASES) {
    const result = run(script, ['--unexpected']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported arguments: --unexpected/);
  }
});
