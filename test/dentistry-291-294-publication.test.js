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

const groups = ['291', '292', '293', '294'];
const expectedCounts = { '291': 265, '292': 266, '293': 266, '294': 269 };
const digest = 'sha256:6b47e359d9910ed04e84e059ea021a6901bf27b461b82c131c9e3f2e7c664c60';

test('Dentistry course 2 publication evidence pins the exact QA-PASS candidate', async () => {
  const [source, draft, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/dentistry-291-294.source.json'),
    readJson('qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json'),
    readJson('qa/2026-2027-semester-1/dentistry-291-294.qa-report.json'),
    readJson('qa/2026-2027-semester-1/dentistry-291-294.publication-evidence.json')
  ]);

  assert.equal(source.universityId, 'kirov-gmu');
  assert.equal(source.programId, 'dentistry');
  assert.equal(source.course, 2);
  assert.deepEqual(source.expectedGroupIds, groups);
  assert.equal(source.source.sha256, 'ec51c194d2f91d33230da4d93d8bad1dfe885d70ec4bd0e2eec959071b4ff610');

  assert.equal(draft.status, 'PASS');
  assert.equal(qa.decision, 'pass');
  assert.equal(draft.candidateDigest, digest);
  assert.equal(qa.candidateDigest, digest);
  assert.equal(publication.candidateDigest, digest);
  assert.equal(publication.eventSetDigest, digestNormalizedEvents(draft.events));
  assert.equal(publication.eventSetDigest, digest);
  assert.equal(draft.events.length, 1066);
  assert.equal(publication.eventCount, 1066);
  assert.deepEqual(draft.groupEventCounts, expectedCounts);
  assert.deepEqual(publication.groupEventCounts, expectedCounts);
  assert.deepEqual(publication.groupDefaultVisibleEventCounts, expectedCounts);
  assert.deepEqual(publication.groupFacultativeEventCounts, { '291': 0, '292': 0, '293': 0, '294': 0 });
  assert.deepEqual(publication.facultativeIds, []);
  assert.equal(new Set(draft.events.map((event) => event.eventId)).size, 1066);
  assert.ok(draft.events.every((event) => event.timeSemantics === 'floating'));
  assert.ok(draft.events.every((event) => event.facultativeId == null));
  assert.ok(draft.events.some((event) => event.assessment));
});

test('Dentistry course 2 publisher is fail-closed around production contracts', async () => {
  const source = await readFile(new URL('../ops/publish-dentistry-291-294.mjs', import.meta.url), 'utf8');
  for (const required of [
    'PRAGMA integrity_check',
    '.deployed-commit',
    'normalizedEventSchemaBlob',
    'icsRendererBlob',
    'exactly one published version',
    'CalendarPreferences',
    'MEDICAL_CALENDAR_DB_PATH',
    'PREFLIGHT_OK_NO_DATABASE_CHANGES'
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(source, /DELETE\s+FROM\s+schedule_versions/i);
  assert.doesNotMatch(source, /rotate|revoke/i);
});

test('Dentistry course 2 publisher preflight reproduces exact stable version plan without DB access', async () => {
  const publisher = new URL('../ops/publish-dentistry-291-294.mjs', import.meta.url);
  const { stdout, stderr } = await execFileAsync(process.execPath, [publisher.pathname, '--preflight'], { encoding: 'utf8' });
  assert.equal(stderr, '');
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
  assert.match(stdout, /"eventCount": 1066/);
  assert.match(stdout, new RegExp(digest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stdout, /"facultativeIds": \[\]/);
  for (const groupId of groups) {
    assert.match(stdout, new RegExp(`kgmu-2026-2027-s1-dentistry-${groupId}-6b47e359d9910ed0`));
  }
});
