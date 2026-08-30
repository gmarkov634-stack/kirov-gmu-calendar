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

function minutes(value) {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

function overlaps(left, right) {
  return minutes(left.startTime) < minutes(right.endTime)
    && minutes(right.startTime) < minutes(left.endTime);
}

test('group 102 one-off Latin C36 lesson is 02.09.2026 at 08:40-10:10', async () => {
  const { manifest, events } = await baseSchedule();
  const decision = manifest.decisions.find(([locator]) => locator === 'C36#s1');
  assert.ok(decision, 'C36#s1 decision is required');
  assert.equal(decision[1], '2', 'C36#s1 must select group 102');
  assert.equal(decision[2], '1', 'C36#s1 must select dateTable index 0 = 2026-09-02');
  assert.equal(decision[3], '08:40', 'C36#s1 must use the group-102 Wednesday Latin start time');
  assert.equal(decision[4], '10:10', 'C36#s1 must use the group-102 Wednesday Latin end time');

  const c36Latin = events.filter((event) =>
    event.groupId === '102' &&
    event.discipline === 'Латинский язык' &&
    event.sourceRef.locator === '1 леч.1!C36#s1'
  );
  assert.deepEqual(c36Latin.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })), [{
    date: '2026-09-02',
    startTime: '08:40',
    endTime: '10:10'
  }]);
  assert.equal(c36Latin.some((event) => event.date === '2026-09-04'), false);

  const sameDay = events.filter((event) => event.groupId === '102' && event.date === '2026-09-02');
  assert.equal(
    sameDay.some((event) => event !== c36Latin[0] && overlaps(c36Latin[0], event)),
    false,
    'corrected Latin lesson must not overlap another group-102 event on 02.09'
  );
});

test('corrected base schedule has the reviewed digest', async () => {
  const { events } = await baseSchedule();
  assert.equal(
    digestNormalizedEvents(events),
    'sha256:2f7c12ef43a0cdfebf3a25ef99a9c2338ae5e424d817178fd901e85ea5eb683b'
  );
});
