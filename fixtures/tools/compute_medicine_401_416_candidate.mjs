#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../../src/explicit-decisions.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = async (path) => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
const [manifest, source] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/medicine-401-416.decisions.json'),
  readJson('fixtures/2026-2027-semester-1/medicine-401-416.source.json')
]);

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

const groupEventCounts = Object.fromEntries(source.expectedGroupIds.map((groupId) => [
  groupId,
  events.filter((event) => event.groupId === groupId).length
]));

const signatures = new Set();
let duplicateEventSignatures = 0;
for (const event of events) {
  const signature = [
    event.groupId,
    event.date,
    event.startTime,
    event.endTime,
    event.discipline,
    event.lessonType,
    event.location ?? ''
  ].join('|');
  if (signatures.has(signature)) duplicateEventSignatures += 1;
  signatures.add(signature);
}

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};
const byDay = new Map();
for (const event of events) {
  const key = `${event.groupId}|${event.date}`;
  if (!byDay.has(key)) byDay.set(key, []);
  byDay.get(key).push(event);
}
const overlaps = [];
for (const [key, dayEvents] of byDay) {
  for (let left = 0; left < dayEvents.length; left += 1) {
    for (let right = left + 1; right < dayEvents.length; right += 1) {
      const a = dayEvents[left];
      const b = dayEvents[right];
      if (minutes(a.startTime) >= minutes(b.endTime) || minutes(b.startTime) >= minutes(a.endTime)) continue;
      overlaps.push({
        key,
        left: a.sourceRef.locator,
        right: b.sourceRef.locator,
        disciplines: [a.discipline, b.discipline]
      });
    }
  }
}

const result = {
  candidateDigest: digestNormalizedEvents(events),
  eventCount: events.length,
  groupEventCounts,
  logicalSourceCellCount: manifest.logicalSourceCellCount,
  decisionCount: manifest.decisionCount,
  duplicateEventSignatures,
  overlapPairCount: overlaps.length,
  overlaps,
  eventDateMin: events.at(0)?.date ?? null,
  eventDateMax: events.reduce((max, event) => event.date > max ? event.date : max, '') || null
};

await writeFile(resolve(ROOT, 'medicine-401-416-candidate.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
