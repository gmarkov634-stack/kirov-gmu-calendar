#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../../src/explicit-decisions.js';
import { expandMedicineFacultativeFixture } from '../../src/medicine-publication-plan.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = async (path) => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};
const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime) && minutes(right.startTime) < minutes(left.endTime);

const [manifest, facultatives, source] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/medicine-101-110.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/medicine-101-110.facultatives.json'),
  readJson('fixtures/2026-2027-semester-1/medicine-101-110.source.json')
]);

const context = {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
};
const compareEvents = (a, b) => [
  Number(a.groupId) - Number(b.groupId),
  a.date.localeCompare(b.date),
  a.startTime.localeCompare(b.startTime),
  a.endTime.localeCompare(b.endTime),
  a.discipline.localeCompare(b.discipline),
  a.lessonType.localeCompare(b.lessonType),
  a.sourceRef.locator.localeCompare(b.sourceRef.locator)
].find((value) => value !== 0) ?? 0;

const baseEvents = expandExplicitDecisionManifest(manifest, context);
const facultativeEvents = expandMedicineFacultativeFixture(facultatives, context);
const events = [...baseEvents, ...facultativeEvents].sort(compareEvents);
const groupEventCounts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
  groupId,
  events.filter((event) => event.groupId === groupId).length
]));
const facultativeCountsById = Object.fromEntries(facultatives.items.map((item) => [
  item.facultativeId,
  facultativeEvents.filter((event) => event.facultativeId === item.facultativeId).length
]));

const signatures = new Set();
let duplicateEventSignatures = 0;
for (const event of events) {
  const signature = [
    event.groupId, event.date, event.startTime, event.endTime,
    event.discipline, event.lessonType, event.location ?? ''
  ].join('|');
  if (signatures.has(signature)) duplicateEventSignatures += 1;
  signatures.add(signature);
}

const byDay = new Map();
for (const event of events) {
  const key = `${event.groupId}|${event.date}`;
  if (!byDay.has(key)) byDay.set(key, []);
  byDay.get(key).push(event);
}
let overlapPairCount = 0;
let overlapPairsInvolvingFacultatives = 0;
for (const dayEvents of byDay.values()) {
  for (let left = 0; left < dayEvents.length; left += 1) {
    for (let right = left + 1; right < dayEvents.length; right += 1) {
      if (!overlaps(dayEvents[left], dayEvents[right])) continue;
      overlapPairCount += 1;
      if (dayEvents[left].facultativeId || dayEvents[right].facultativeId) {
        overlapPairsInvolvingFacultatives += 1;
      }
    }
  }
}

const result = {
  candidateDigest: digestNormalizedEvents(events),
  eventCount: events.length,
  baseEventCount: baseEvents.length,
  facultativeEventCount: facultativeEvents.length,
  groupEventCounts,
  facultativeCountsById,
  duplicateEventSignatures,
  overlapPairCount,
  overlapPairsInvolvingFacultatives
};
await writeFile(resolve(ROOT, 'medicine-101-110-candidate.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
