import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

import { digestNormalizedEvents } from '../src/explicit-decisions.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const groups = ['491', '492', '493', '494'];
const expectedCounts = { '491': 133, '492': 133, '493': 133, '494': 132 };
const expectedDateOnlyCounts = { '491': 12, '492': 12, '493': 12, '494': 12 };
const digest = 'sha256:2a0490e90c89cfb40004b128c8429f896108ff9fc98e98cd1426adae171931a1';
const persistenceProjection = 'drop-null-date-only-times-v1';

test('Dentistry course 4 publication evidence pins the exact QA-PASS candidate', async () => {
  const [sourceArtifact, parsingJob, draft, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/dentistry-491-494.source-artifact.json'),
    readJson('fixtures/2026-2027-semester-1/dentistry-491-494.parsing-job.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.normalized-draft.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.qa-report.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.publication-evidence.json')
  ]);

  assert.equal(sourceArtifact.universityId, 'kirov-gmu');
  assert.equal(sourceArtifact.sourceId, 'dentistry');
  assert.equal(sourceArtifact.academicPeriodId, '2026-2027-semester-1');
  assert.deepEqual(sourceArtifact.expectedGroupIds, groups);
  assert.deepEqual(parsingJob.expectedGroupIds, groups);
  assert.equal(sourceArtifact.sha256, '2e945ca99ec75bfbe7f98402d0752ebe96afbd12780d29c7f5cdf32f7e22b265');
  assert.equal(parsingJob.parserRulesVersion, 'kgmu-2026-08-27-v3');

  assert.equal(draft.status, 'PASS');
  assert.equal(qa.status, 'PASS');
  assert.equal(qa.publishEligible, true);
  assert.equal(qa.scheduleVersionReady, true);
  assert.deepEqual(qa.blockers, []);
  assert.ok(qa.checks.every((check) => check.status === 'PASS'));
  assert.equal(draft.candidateDigest, digest);
  assert.equal(qa.candidateDigest, digest);
  assert.equal(publication.candidateDigest, digest);
  assert.equal(publication.eventSetDigest, digestNormalizedEvents(draft.events));
  assert.equal(publication.eventSetDigest, digest);
  assert.equal(draft.events.length, 531);
  assert.equal(publication.eventCount, 531);
  assert.deepEqual(draft.eventCountsByGroup, expectedCounts);
  assert.deepEqual(publication.groupEventCounts, expectedCounts);
  assert.deepEqual(publication.groupDefaultVisibleEventCounts, expectedCounts);
  assert.deepEqual(publication.groupDateOnlyEventCounts, expectedDateOnlyCounts);
  assert.deepEqual(publication.groupFacultativeEventCounts, { '491': 0, '492': 0, '493': 0, '494': 0 });
  assert.deepEqual(publication.facultativeIds, []);
  assert.equal(new Set(draft.events.map((event) => event.eventId)).size, 531);
  const legacyDateOnly = draft.events.filter((event) => event.timeSemantics === 'date-only');
  assert.equal(legacyDateOnly.length, 48);
  assert.ok(legacyDateOnly.every((event) => event.discipline === 'Практика'));
  assert.ok(legacyDateOnly.every((event) => Object.hasOwn(event, 'startTime') && Object.hasOwn(event, 'endTime')));
  assert.ok(legacyDateOnly.every((event) => event.startTime === null && event.endTime === null));
  assert.ok(draft.events.every((event) => event.facultativeId == null));
});

test('Dentistry course 4 publisher is fail-closed around production contracts', async () => {
  const source = await readFile(new URL('../ops/publish-dentistry-491-494.mjs', import.meta.url), 'utf8');
  for (const required of [
    'PRAGMA integrity_check',
    'PRAGMA foreign_key_check',
    '.deployed-commit',
    'normalizedEventSchemaBlob',
    'icsRendererBlob',
    'exactly one published version',
    'MEDICAL_CALENDAR_DB_PATH',
    'PREFLIGHT_OK_NO_DATABASE_CHANGES',
    'subscriptionTokensChanged: false',
    'calendarPreferencesChanged: false',
    persistenceProjection,
    'projectApprovedEventsForCore',
    'delete projected.startTime',
    'delete projected.endTime'
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(source, /DELETE\s+FROM\s+schedule_versions/i);
  assert.doesNotMatch(source, /rotate|revoke/i);
});

test('Dentistry course 4 publisher preflight reproduces exact stable version plan and core-safe date-only projection without DB access', async () => {
  const publisher = new URL('../ops/publish-dentistry-491-494.mjs', import.meta.url);
  const { stdout, stderr } = await execFileAsync(process.execPath, [publisher.pathname, '--preflight'], { encoding: 'utf8' });
  assert.equal(stderr, '');
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
  const payload = JSON.parse(stdout.slice(0, stdout.indexOf('\nPREFLIGHT_OK_NO_DATABASE_CHANGES')));
  assert.equal(payload.eventCount, 531);
  assert.equal(payload.dateOnlyEventCount, 48);
  assert.equal(payload.candidateDigest, digest);
  assert.equal(payload.eventSetDigest, digest);
  assert.equal(payload.persistenceProjection, persistenceProjection);
  assert.match(payload.persistenceEventSetDigest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(payload.persistenceEventSetDigest, digest);
  assert.deepEqual(payload.facultativeIds, []);
  for (const groupId of groups) {
    assert.match(stdout, new RegExp(`kgmu-2026-2027-s1-dentistry-${groupId}-2a0490e90c89cfb4`));
  }
});
