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
const result = {
  candidateDigest: digestNormalizedEvents(events),
  eventCount: events.length,
  baseEventCount: baseEvents.length,
  facultativeEventCount: facultativeEvents.length,
  groupEventCounts,
  facultativeCountsById
};
await writeFile(resolve(ROOT, 'medicine-101-110-candidate.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
