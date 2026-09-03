import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

import { digestNormalizedEvents } from '../src/explicit-decisions.js';
import { toCorePersistenceEvents } from '../src/core-persistence-events.js';

const execFileAsync = promisify(execFile);
const approvedDigest = 'sha256:2a0490e90c89cfb40004b128c8429f896108ff9fc98e98cd1426adae171931a1';

async function readDraft() {
  return JSON.parse(await readFile(new URL('../qa/2026-2027-semester-1/dentistry-491-494.normalized-draft.json', import.meta.url), 'utf8'));
}

test('Dentistry course 4 keeps the approved candidate while adapting date-only events for Core persistence', async () => {
  const draft = await readDraft();
  const rawEvents = draft.events;
  const rawDateOnly = rawEvents.filter((event) => event.timeSemantics === 'date-only');

  assert.equal(draft.candidateDigest, approvedDigest);
  assert.equal(digestNormalizedEvents(rawEvents), approvedDigest);
  assert.equal(rawEvents.length, 531);
  assert.equal(rawDateOnly.length, 48);
  assert.ok(rawDateOnly.every((event) => event.startTime === null && event.endTime === null));

  const persistenceEvents = toCorePersistenceEvents(rawEvents);
  const persistenceDateOnly = persistenceEvents.filter((event) => event.timeSemantics === 'date-only');
  const persistenceFloating = persistenceEvents.filter((event) => event.timeSemantics === 'floating');

  assert.equal(persistenceEvents.length, rawEvents.length);
  assert.deepEqual(persistenceEvents.map((event) => event.eventId), rawEvents.map((event) => event.eventId));
  assert.equal(persistenceDateOnly.length, 48);
  assert.ok(persistenceDateOnly.every((event) => !Object.hasOwn(event, 'startTime') && !Object.hasOwn(event, 'endTime')));
  assert.ok(persistenceFloating.every((event) => typeof event.startTime === 'string' && event.startTime.length > 0));
  assert.ok(persistenceFloating.every((event) => typeof event.endTime === 'string' && event.endTime.length > 0));

  assert.equal(draft.candidateDigest, approvedDigest);
  assert.equal(digestNormalizedEvents(rawEvents), approvedDigest);
  assert.ok(rawDateOnly.every((event) => Object.hasOwn(event, 'startTime') && Object.hasOwn(event, 'endTime')));
});

test('Dentistry course 4 preflight validates the Core persistence representation before DB access', async () => {
  const publisher = new URL('../ops/publish-dentistry-491-494.mjs', import.meta.url);
  const { stdout, stderr } = await execFileAsync(process.execPath, [publisher.pathname, '--preflight'], { encoding: 'utf8' });

  assert.equal(stderr, '');
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
  assert.match(stdout, /"candidateDigest": "sha256:2a0490e90c89cfb40004b128c8429f896108ff9fc98e98cd1426adae171931a1"/);
  assert.match(stdout, /"eventCount": 531/);
  assert.match(stdout, /"dateOnlyEventCount": 48/);
  assert.match(stdout, /"persistenceDateOnlyTimingFieldsOmitted": true/);
});
