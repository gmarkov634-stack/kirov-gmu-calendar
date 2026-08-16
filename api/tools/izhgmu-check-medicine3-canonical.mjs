import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIzhgmuMedicine3CompositeCanonicalBatch } from '../src/adapters/izhgmu/medicine3-composite.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const group = String(arg('--group', '301'));
const resolution = JSON.parse(await fs.readFile(path.join(inputDir, 'medicine3-time-resolution.json'), 'utf8'));
const cycles = JSON.parse(await fs.readFile(path.join(inputDir, 'medicine3-legacy-cycle.json'), 'utf8'));

const candidate = buildIzhgmuMedicine3CompositeCanonicalBatch({
  resolution,
  metadata: {
    academicYear: '2025/2026',
    semester: 'spring',
    facultyCode: 'medicine',
    course: 3,
    groupCode: group,
    period: {
      start_date: cycles.period.start_date,
      end_date: cycles.period.end_date,
      week1_start_date: cycles.period.start_date,
    },
  },
});

const expectedByGroup = {
  301: 198, 302: 198, 303: 198, 304: 198, 305: 198, 306: 198,
  307: 194, 308: 194, 309: 194, 310: 194, 311: 194, 312: 194, 313: 194, 314: 194,
  315: 198, 316: 198, 317: 198, 318: 198, 319: 198, 320: 198,
};
const expectedEvents = expectedByGroup[group];
if (!expectedEvents) throw new Error(`IZH-M3 canonical checker only covers current content-ready groups 301-320, got ${group}`);
if (candidate.events.length !== expectedEvents) {
  throw new Error(`IZH-M3 group ${group} event count changed: ${candidate.events.length}/${expectedEvents}`);
}

const prepared = prepareSchedulePublication(candidate, {
  now: '2026-08-17T00:00:00.000Z',
});

if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
  throw new Error(`IZH-M3 group ${group} shared QA did not pass`);
}
if (!prepared.ics || !prepared.ics.includes('BEGIN:VCALENDAR') || !prepared.ics.includes('BEGIN:VEVENT')) {
  throw new Error(`IZH-M3 group ${group} ICS preflight is empty/invalid`);
}

const overlaps = [];
for (const event of prepared.batch.events) {
  if (!event.derived?.day?.overlaps_next) continue;
  overlaps.push({
    date: event.timing.date,
    current: {
      discipline: event.lesson.discipline.normalized,
      type: event.lesson.type.code,
      start: event.timing.start_time,
      end: event.timing.end_time,
      source: event.source.file_name,
    },
    next: event.derived.day.next_event,
    gapMinutes: event.derived.day.gap_minutes,
  });
}

const sourceCounts = {};
for (const event of prepared.batch.events) {
  sourceCounts[event.source.file_name] = (sourceCounts[event.source.file_name] || 0) + 1;
}

const result = {
  profile: 'IZH-MEDICINE3-CANONICAL-QA',
  version: 1,
  group,
  eventCount: prepared.batch.events.length,
  inputQa: {
    publishable: prepared.inputQa.publishable,
    errors: prepared.inputQa.errors.length,
    warnings: prepared.inputQa.warnings.length,
  },
  outputQa: {
    publishable: prepared.outputQa.publishable,
    errors: prepared.outputQa.errors.length,
    warnings: prepared.outputQa.warnings.length,
  },
  icsBytes: Buffer.byteLength(prepared.ics, 'utf8'),
  sourceCounts,
  overlapCount: overlaps.length,
  overlaps,
  semanticOverlapReviewRequired: overlaps.length > 0,
  productionAuthorized: false,
};

await fs.writeFile(
  path.join(inputDir, `medicine3-canonical-${group}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);
console.log('IZHGMU_MEDICINE3_CANONICAL_QA', JSON.stringify({
  group,
  eventCount: result.eventCount,
  inputQa: result.inputQa,
  outputQa: result.outputQa,
  icsBytes: result.icsBytes,
  sourceCounts: result.sourceCounts,
  overlapCount: result.overlapCount,
  semanticOverlapReviewRequired: result.semanticOverlapReviewRequired,
  productionAuthorized: false,
}));
for (const overlap of overlaps) {
  console.log('IZHGMU_MEDICINE3_OVERLAP', JSON.stringify(overlap));
}
