import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildIzhgmuMedicine3PublicationCandidate,
  buildIzhgmuMedicine3PublicationCanonicalBatch,
} from '../src/adapters/izhgmu/medicine3-publication.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sequence(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const requestedGroup = String(arg('--group', 'all'));
const groups = requestedGroup === 'all' ? sequence(301, 326) : [requestedGroup];
const resolution = JSON.parse(await fs.readFile(path.join(inputDir, 'medicine3-time-resolution.json'), 'utf8'));
const cycles = JSON.parse(await fs.readFile(path.join(inputDir, 'medicine3-legacy-cycle.json'), 'utf8'));

const expectedByGroup = {
  301: 183, 302: 183, 303: 183, 304: 183, 305: 183, 306: 183,
  307: 179, 308: 179, 309: 179, 310: 179, 311: 179, 312: 179, 313: 179, 314: 179,
  315: 183, 316: 183, 317: 183, 318: 183, 319: 183, 320: 183,
  321: 180, 322: 180, 323: 180, 324: 180, 325: 180, 326: 180,
};

const results = [];
for (const group of groups) {
  const expectedEvents = expectedByGroup[group];
  if (!expectedEvents) throw new Error(`IZH-M3 canonical checker does not recognize group ${group}`);

  const input = {
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
  };

  const publication = buildIzhgmuMedicine3PublicationCandidate(input);
  if (!publication.publishable || publication.blockers.length !== 0) {
    throw new Error(`IZH-M3 group ${group} publication candidate still has ${publication.blockers.length} blocker(s)`);
  }
  if (publication.exclusion.discipline !== 'Стоматология') {
    throw new Error(`IZH-M3 group ${group} temporary exclusion discipline changed`);
  }
  if (
    publication.exclusion.removed.practiceEvents !== 8
    || publication.exclusion.removed.lectureEvents !== 7
    || publication.exclusion.removed.blockers !== 7
    || publication.exclusion.removed.totalEvents !== 15
  ) {
    throw new Error(`IZH-M3 group ${group} Stomatology exclusion cardinality changed`);
  }

  const stomatologyEvents = publication.batch.events.filter((event) => (
    event.lesson?.discipline?.normalized === 'Стоматология'
  ));
  if (stomatologyEvents.length !== 0) {
    throw new Error(`IZH-M3 group ${group} publication candidate still contains Stomatology`);
  }
  if (publication.batch.events.length !== expectedEvents) {
    throw new Error(`IZH-M3 group ${group} event count changed: ${publication.batch.events.length}/${expectedEvents}`);
  }

  const canonical = buildIzhgmuMedicine3PublicationCanonicalBatch(input);
  const prepared = prepareSchedulePublication(canonical, {
    now: '2026-08-17T00:00:00.000Z',
  });

  if (!prepared.inputQa.publishable || !prepared.outputQa.publishable) {
    throw new Error(`IZH-M3 group ${group} shared publication QA did not pass`);
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
  if (overlaps.length !== 0) {
    throw new Error(`IZH-M3 group ${group} has ${overlaps.length} semantic time overlap(s) after Stomatology exclusion`);
  }

  const sourceCounts = {};
  for (const event of prepared.batch.events) {
    sourceCounts[event.source.file_name] = (sourceCounts[event.source.file_name] || 0) + 1;
  }

  const result = {
    profile: 'IZH-MEDICINE3-CANONICAL-QA',
    version: 3,
    group,
    eventCount: prepared.batch.events.length,
    contentReady: true,
    blockers: [],
    exclusion: publication.exclusion,
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
    overlapCount: 0,
    semanticOverlapReviewRequired: false,
    productionAuthorized: false,
    authorizationReason: 'IzhGMU remains inactive and the current official source set is spring 2025/2026.',
  };

  await fs.writeFile(
    path.join(inputDir, `medicine3-canonical-${group}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  results.push(result);
  console.log('IZHGMU_MEDICINE3_CANONICAL_QA_GROUP', JSON.stringify({
    group,
    eventCount: result.eventCount,
    contentReady: result.contentReady,
    exclusion: result.exclusion.removed,
    inputQa: result.inputQa,
    outputQa: result.outputQa,
    icsBytes: result.icsBytes,
    sourceCounts: result.sourceCounts,
    overlapCount: result.overlapCount,
    productionAuthorized: false,
  }));
}

const summary = {
  profile: 'IZH-MEDICINE3-CANONICAL-QA-SUMMARY',
  version: 1,
  groupCount: results.length,
  groups: results.map((item) => item.group),
  contentReadyGroupCount: results.filter((item) => item.contentReady).length,
  totalEvents: results.reduce((sum, item) => sum + item.eventCount, 0),
  totalOverlaps: results.reduce((sum, item) => sum + item.overlapCount, 0),
  excludedDiscipline: 'Стоматология',
  productionAuthorized: false,
};
await fs.writeFile(
  path.join(inputDir, 'medicine3-canonical-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);
console.log('IZHGMU_MEDICINE3_CANONICAL_QA', JSON.stringify(summary));
