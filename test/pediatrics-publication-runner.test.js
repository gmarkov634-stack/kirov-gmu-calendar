import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CASES = [
  {
    script: 'ops/publish-pediatrics-131-140.mjs',
    candidateDigest: 'sha256:ffd0fc5cc78fe0dbfb9f8577c5dd37d58713c3551260a810c5f77096bda7626e',
    eventCount: 3819,
    firstGroupId: '131',
    firstVersionId: 'kgmu-2026-2027-s1-pediatrics-131-ffd0fc5cc78fe0db'
  },
  {
    script: 'ops/publish-pediatrics-231-239.mjs',
    candidateDigest: 'sha256:59ea4ed15af1678e205f62c56ee9fa7c7fc74e40570d19c8b1f6b4098e1bfb20',
    eventCount: 2353,
    firstGroupId: '231',
    firstVersionId: 'kgmu-2026-2027-s1-pediatrics-231-59ea4ed15af1678e'
  },
  {
    script: 'ops/publish-pediatrics-331-337.mjs',
    candidateDigest: 'sha256:19fcc970c203a672a4d2da12eb3e4791b48312c3c3d2d84943dc7ffd6b3129dc',
    eventCount: 1781,
    firstGroupId: '331',
    firstVersionId: 'kgmu-2026-2027-s1-pediatrics-331-19fcc970c203a672'
  },
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
  },
  {
    script: 'ops/publish-pediatrics-631-637.mjs',
    candidateDigest: 'sha256:d2e3987a60ea05fc97de83afba9993285022dd932fd16a082da155efe589567f',
    eventCount: 679,
    firstGroupId: '631',
    firstVersionId: 'kgmu-2026-2027-s1-pediatrics-631-d2e3987a60ea05fc',
    floatingEventCount: 637,
    dateOnlyEventCount: 42
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
    if (fixture.floatingEventCount != null) assert.equal(summary.floatingEventCount, fixture.floatingEventCount);
    if (fixture.dateOnlyEventCount != null) assert.equal(summary.dateOnlyEventCount, fixture.dateOnlyEventCount);
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

test('early pediatrics entrypoints delegate publication lifecycle while retaining course-specific ICS policies', () => {
  const course1 = readFileSync('ops/publish-pediatrics-131-140.mjs', 'utf8');
  const course2 = readFileSync('ops/publish-pediatrics-231-239.mjs', 'utf8');
  for (const source of [course1, course2]) {
    assert.match(source, /runPediatricsPublication/);
    assert.match(source, /verifyPublishedIcs/);
  }
  assert.match(course1, /requireProductionRuntimeCommit: false/);
  assert.match(course1, /default-off ICS VEVENT count verification failed/);
  assert.match(course1, /all-facultatives ICS VEVENT count verification failed/);
  assert.match(course1, /ЗАЧЕТ С ОЦЕНКОЙ/);
  assert.match(course2, /includeApprovedMainCommit: true/);
  assert.match(course2, /lecture display prefix is missing from rendered ICS/);
});

test('Pediatrics course 3 delegates shared publication lifecycle and retains lecture ICS verification', () => {
  const course3 = readFileSync('ops/publish-pediatrics-331-337.mjs', 'utf8');
  assert.match(course3, /runPediatricsPublication/);
  assert.match(course3, /verifyPublishedIcs: verifyCourse3Ics/);
  assert.match(course3, /lecture display prefix is missing from rendered ICS/);
  assert.match(course3, /PRODUCTION_PEDIATRICS_COURSE_3_SCHEDULES_PUBLISHED_AND_VERIFIED/);
});

test('Pediatrics course 6 delegates shared lifecycle while retaining date-only compatibility boundaries', () => {
  const course6 = readFileSync('ops/publish-pediatrics-631-637.mjs', 'utf8');
  assert.match(course6, /runPediatricsPublication/);
  assert.match(course6, /validateCoreEvidence: validateCourse6CoreEvidence/);
  assert.match(course6, /verifyDatabaseState: verifyCourse6DatabaseState/);
  assert.match(course6, /verifyPublishedIcs: verifyCourse6Ics/);
  assert.match(course6, /008_date_only_event_timing/);
  assert.match(course6, /PRAGMA foreign_key_check/);
  assert.match(course6, /DTSTART;VALUE=DATE/);
  assert.match(course6, /BEGIN:VALARM/);
  assert.match(course6, /acquired synthetic timing\/alarm/);
  assert.match(course6, /PRODUCTION_PEDIATRICS_COURSE_6_SCHEDULES_PUBLISHED_AND_VERIFIED/);
});
