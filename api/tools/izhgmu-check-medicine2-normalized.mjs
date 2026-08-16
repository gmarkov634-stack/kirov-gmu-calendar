import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import {
  normalizeIzhgmuMedicine2ClassStructure,
  normalizeIzhgmuMedicine2LectureStructure,
  normalizeIzhgmuMedicine2CompanionForWeekly,
  normalizeIzhgmuMedicine2Combined,
} from '../src/adapters/izhgmu/medicine2-normalization.mjs';
import { buildIzhgmuWeeklyLectureCanonicalBatch } from '../src/adapters/izhgmu/canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function pair(report, stream) {
  const items = report.files.filter((item) => item.status === 'downloaded'
    && item.spreadsheetKind === 'xlsx' && item.faculty === 'medicine' && Number(item.course) === 2
    && String(item.stream ?? '') === String(stream) && item.language === 'ru' && item.term === 'spring');
  const classSource = items.find((item) => item.sourceKind === 'class');
  const lectureSource = items.find((item) => item.sourceKind === 'lecture');
  if (!classSource || !lectureSource) throw new Error(`medicine-2 source pair missing for stream ${stream}`);
  return { classSource, lectureSource };
}

function groups(structure) {
  const sheet = structure.sheets.find((item) => item.name.toLowerCase().includes('расписание'));
  const cells = sheet.cells.filter((cell) => /^2\d{2}$/.test(norm(cell.value)) && cell.row <= 10);
  const byRow = new Map();
  for (const cell of cells) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  return ([...byRow.values()].sort((a, b) => b.length - a.length)[0] || [])
    .sort((a, b) => a.col - b.col).map((cell) => norm(cell.value));
}

function warningCounts(items) {
  const counts = {};
  for (const item of items || []) counts[item.warning || 'unknown'] = (counts[item.warning || 'unknown'] || 0) + 1;
  return counts;
}

function ruleCount(events, ruleId) {
  return events.filter((event) => (event.parse?.rule_ids || []).includes(ruleId)).length;
}

function referenceIncludes(event, needle) {
  return (event.source?.references || []).some((reference) => String(reference.range || '').includes(needle));
}

function overlapDiagnostics(events) {
  return events.filter((event) => event.derived?.day?.overlaps_next).map((event) => ({
    date: event.timing.date,
    discipline: event.lesson.discipline.normalized,
    type: event.lesson.type.code,
    start: event.timing.start_time,
    end: event.timing.end_time,
    next: event.derived.day.next_event,
    gapMinutes: event.derived.day.gap_minutes,
  }));
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine2-normalized.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const result = { version: 2, course: 2, streams: [] };

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = pair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) throw new Error(`SHA mismatch stream ${stream}`);
  const [rawClass, rawLecture] = await Promise.all([readIzhgmuXlsxStructure(classBuffer), readIzhgmuXlsxStructure(lectureBuffer)]);
  const classStructure = normalizeIzhgmuMedicine2ClassStructure(rawClass);
  const lectureStructure = normalizeIzhgmuMedicine2LectureStructure(rawLecture);
  const companion = normalizeIzhgmuMedicine2CompanionForWeekly(lectureStructure);
  const groupCodes = groups(classStructure);
  const groupResults = [];

  for (const groupCode of groupCodes) {
    const weekly = parseIzhgmuWeeklyStructures({ classStructure, companionStructure: companion, groupCode });
    const lecture = parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed: weekly });
    const rawCombined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });
    const combined = normalizeIzhgmuMedicine2Combined(rawCombined, { classStructure, lectureStructure });
    if (!combined.publishable || combined.reviewRequired.length || combined.deferred.length || combined.unresolvedChoices.length) {
      const error = new Error(`IZH-M2 group ${groupCode} normalized source is incomplete`);
      error.code = 'IZH_M2_NORMALIZED_INCOMPLETE';
      error.details = {
        reviewRequired: combined.reviewRequired,
        deferred: combined.deferred,
        unresolvedChoices: combined.unresolvedChoices,
      };
      throw error;
    }

    const metadata = { academicYear: '2025/2026', semester: 'spring', facultyCode: 'medicine', course: 2, groupCode, stream };
    const source = { classFileName: classSource.filename, classFileHash: classSource.sha256, companionFileName: lectureSource.filename, companionFileHash: lectureSource.sha256 };
    const candidate = buildIzhgmuWeeklyLectureCanonicalBatch({ parsed: combined, metadata, source });
    if (candidate.schedule.source_files.length !== 2
      || !candidate.schedule.source_files.includes(classSource.filename)
      || !candidate.schedule.source_files.includes(lectureSource.filename)) {
      throw new Error(`IZH-M2 group ${groupCode} canonical source_files provenance changed`);
    }

    const publication = prepareSchedulePublication(candidate, { now: '2026-08-17T00:00:00.000Z' });
    if (!publication.inputQa.publishable || !publication.outputQa.publishable) {
      const error = new Error(`IZH-M2 group ${groupCode} shared canonical QA failed`);
      error.code = 'IZH_M2_CANONICAL_QA_FAILED';
      error.details = { inputQa: publication.inputQa, outputQa: publication.outputQa };
      throw error;
    }
    if (!publication.ics || !publication.ics.includes('BEGIN:VCALENDAR') || !publication.ics.includes('BEGIN:VEVENT')) {
      throw new Error(`IZH-M2 group ${groupCode} ICS preflight failed`);
    }

    const events = publication.batch.events;
    const m201Events = events.filter((event) => (event.parse?.rule_ids || []).includes('IZH-M2-01'));
    const m204Events = events.filter((event) => (event.parse?.rule_ids || []).includes('IZH-M2-04'));
    if (stream === '1') {
      if (!m204Events.length) throw new Error(`IZH-M2 group ${groupCode} lost IZH-M2-04 provenance`);
      if (!m204Events.every((event) => referenceIncludes(event, `${lectureSource.filename}::Лист1!H8`))) {
        throw new Error(`IZH-M2 group ${groupCode} IZH-M2-04 reference provenance changed`);
      }
    }
    if (stream === '2' || stream === '3') {
      if (!m201Events.length) throw new Error(`IZH-M2 group ${groupCode} lost IZH-M2-01 provenance`);
      if (!m201Events.every((event) => referenceIncludes(event, `${classSource.filename}::расписание!B`))) {
        throw new Error(`IZH-M2 group ${groupCode} IZH-M2-01 class-slot provenance changed`);
      }
    }

    const sourceCounts = {};
    for (const event of events) sourceCounts[event.source.file_name] = (sourceCounts[event.source.file_name] || 0) + 1;
    const overlaps = overlapDiagnostics(events);
    groupResults.push({
      groupCode,
      publishable: combined.publishable,
      events: events.length,
      reviewRequired: combined.reviewRequired.length,
      reviewWarnings: warningCounts(combined.reviewRequired),
      deferred: combined.deferred.length,
      annotations: combined.informationalAnnotations?.length || 0,
      inputQa: {
        publishable: publication.inputQa.publishable,
        errors: publication.inputQa.errors.length,
        warnings: publication.inputQa.warnings.length,
      },
      outputQa: {
        publishable: publication.outputQa.publishable,
        errors: publication.outputQa.errors.length,
        warnings: publication.outputQa.warnings.length,
      },
      icsBytes: Buffer.byteLength(publication.ics, 'utf8'),
      sourceCounts,
      normalizationRuleEvents: {
        'IZH-M2-01': ruleCount(events, 'IZH-M2-01'),
        'IZH-M2-04': ruleCount(events, 'IZH-M2-04'),
      },
      overlapCount: overlaps.length,
      overlaps,
      semanticOverlapReviewRequired: overlaps.length > 0,
    });
  }

  result.streams.push({ stream, groups: groupCodes, groupResults });
}

const all = result.streams.flatMap((item) => item.groupResults);
result.summary = {
  groups: all.length,
  contentReady: all.filter((item) => item.publishable).length,
  blocked: all.filter((item) => !item.publishable).length,
  groupsWithReview: all.filter((item) => item.reviewRequired > 0).length,
  groupsWithDeferred: all.filter((item) => item.deferred > 0).length,
  canonicalQaPassed: all.filter((item) => item.inputQa.publishable && item.outputQa.publishable).length,
  groupsWithOverlaps: all.filter((item) => item.overlapCount > 0).length,
  overlapCount: all.reduce((count, item) => count + item.overlapCount, 0),
  warnings: all.reduce((acc, item) => {
    for (const [key, value] of Object.entries(item.reviewWarnings)) acc[key] = (acc[key] || 0) + value;
    return acc;
  }, {}),
  productionBoundaryExercised: true,
  productionAuthorized: false,
};

await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE2_NORMALIZED', JSON.stringify(result.summary));
for (const item of result.streams) {
  console.log('STREAM', item.stream, JSON.stringify(item.groupResults.map((group) => ({
    groupCode: group.groupCode,
    publishable: group.publishable,
    events: group.events,
    inputQa: group.inputQa,
    outputQa: group.outputQa,
    icsBytes: group.icsBytes,
    sourceCounts: group.sourceCounts,
    normalizationRuleEvents: group.normalizationRuleEvents,
    overlapCount: group.overlapCount,
    semanticOverlapReviewRequired: group.semanticOverlapReviewRequired,
  }))));
}
