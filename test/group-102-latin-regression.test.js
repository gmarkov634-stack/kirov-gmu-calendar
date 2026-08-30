import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

async function baseSchedule() {
  const [manifest, source] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json')
  ]);
  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  return { manifest, events };
}

test('group 102 one-off Latin C36 lesson is on 02.09.2026, not 04.09.2026', async () => {
  const { manifest, events } = await baseSchedule();
  const decision = manifest.decisions.find(([locator]) => locator === 'C36#s1');
  assert.ok(decision, 'C36#s1 decision is required');
  assert.equal(decision[1], '2', 'C36#s1 must select group 102');
  assert.equal(decision[2], '1', 'C36#s1 must select dateTable index 0 = 2026-09-02');

  const c36Latin = events.filter((event) =>
    event.groupId === '102' &&
    event.discipline === 'Латинский язык' &&
    event.sourceRef.locator === '1 леч.1!C36#s1'
  );
  assert.deepEqual(c36Latin.map((event) => event.date), ['2026-09-02']);
  assert.equal(c36Latin.some((event) => event.date === '2026-09-04'), false);
});

test('corrected base schedule has the reviewed digest', async () => {
  const { events } = await baseSchedule();
  assert.equal(
    digestNormalizedEvents(events),
    'sha256:0a054cd2f08d2a6fa7adfe48984d49d8ebd9c96acc75c8c8a5a068c018d4f907'
  );
});
