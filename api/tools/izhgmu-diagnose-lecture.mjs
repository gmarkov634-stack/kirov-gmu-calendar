import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuWeeklyPair } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLecturePair } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import {
  buildIzhgmuWeeklyLectureQaCandidate,
  izhgmuWeeklyLectureBlockers,
} from '../src/adapters/izhgmu/canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function academicYear(value) {
  const match = String(value || '').match(/(20\d{2})\D+(20\d{2}|\d{2})/);
  if (!match) return String(value || '');
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) end = Math.floor(start / 100) * 100 + end;
  return `${start}/${end}`;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const groupCode = arg('--group', '109');
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const match = (kind) => report.files.find((item) => item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 1
  && String(item.stream ?? '') === '1'
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === kind);
const classSource = match('class');
const lectureSource = match('lecture');
if (!classSource || !lectureSource) throw new Error('IzhGMU diagnostic source pair missing');
const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
const weekly = await parseIzhgmuWeeklyPair({ classBuffer, companionBuffer: lectureBuffer, groupCode });
const lecture = await parseIzhgmuLecturePair({ classBuffer, lectureBuffer, weeklyParsed: weekly });
const combined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });

let candidate = null;
let prepared = null;
let canonicalError = null;
try {
  candidate = buildIzhgmuWeeklyLectureQaCandidate({
    parsed: combined,
    metadata: {
      academicYear: academicYear(classSource.academicYear),
      semester: 'spring',
      facultyCode: 'medicine',
      course: 1,
      groupCode,
      stream: '1',
    },
    source: {
      classFileName: classSource.filename,
      classFileHash: classSource.sha256,
      companionFileName: lectureSource.filename,
      companionFileHash: lectureSource.sha256,
    },
  });
  prepared = prepareSchedulePublication(candidate, { now: '2026-08-15T19:30:00.000Z' });
} catch (error) {
  canonicalError = {
    name: error.name,
    code: error.code || null,
    message: error.message,
    errors: error.errors || null,
    warnings: error.warnings || null,
  };
}

const surgical = candidate?.events?.find((event) => (
  event.timing.date === '2026-02-16'
  && event.timing.start_time === '08:30'
  && event.lesson.discipline.normalized === 'Хирургический уход'
));
const may11 = candidate?.events?.filter((event) => event.timing.date === '2026-05-11').map((event) => ({
  start: event.timing.start_time,
  end: event.timing.end_time,
  discipline: event.lesson.discipline.normalized,
  source: event.source.file_name,
})) || [];

const diagnostic = {
  sourceFiles: [classSource.filename, lectureSource.filename],
  weekly: {
    series: weekly.series.length,
    reviewRequired: weekly.reviewRequired.map((item) => ({ warning: item.warning, ref: item.references?.[0]?.range || null })),
    deferred: weekly.deferred.length,
  },
  lecture: {
    stats: lecture.stats,
    reviewRequired: lecture.reviewRequired.map((item) => ({
      discipline: item.discipline || null,
      warning: item.warning || null,
      warnings: item.warnings || [],
      startTime: item.startTime || null,
      endTime: item.endTime || null,
      dates: item.dates?.length || 0,
      slotKey: item.slotKey || null,
      ref: item.references?.[0]?.range || null,
    })),
    choiceOptionCount: lecture.choiceRequired?.options?.length || 0,
    choiceDisciplines: lecture.choiceRequired?.options?.map((item) => item.discipline) || [],
    classCoverage: {
      total: lecture.classCoverage.totalWideBlocks,
      resolved: lecture.classCoverage.resolvedByLecture.length,
      choice: lecture.classCoverage.choiceRequired.length,
      unmapped: lecture.classCoverage.unmapped.length,
      blocks: lecture.classCoverage.blocks.map((item) => ({
        ref: item.ref,
        row: item.row,
        value: item.value,
        weekday: item.weekday,
        recoveredDay: item.dayRecoveredFromTimeSlot,
        startTime: item.startTime,
        endTime: item.endTime,
        slotKey: item.slotKey,
        choiceRequired: item.choiceRequired,
        coverage: item.coverage,
      })),
    },
    series: lecture.series.map((item) => ({
      discipline: item.discipline,
      weekday: item.weekday,
      startTime: item.startTime,
      endTime: item.endTime,
      parity: item.parity,
      dates: item.dates.length,
      firstDate: item.dates[0] || null,
      lastDate: item.dates.at(-1) || null,
      declaredCount: item.declaredCount,
      declaredCountScope: item.declaredCountScope,
      status: item.status,
      warning: item.warning,
      choiceRequired: item.choiceRequired,
      slotKey: item.slotKey,
    })),
  },
  combined: {
    reviewRequired: combined.reviewRequired.map((item) => item.warning || item.warnings?.[0] || null),
    unresolvedChoices: combined.unresolvedChoices.length,
    deferred: combined.deferred.length,
    publishable: combined.publishable,
    blockers: izhgmuWeeklyLectureBlockers(combined),
  },
  canonical: {
    candidateEventCount: candidate?.events?.length ?? null,
    error: canonicalError,
    inputQa: prepared ? {
      publishable: prepared.inputQa.publishable,
      errors: prepared.inputQa.errors,
      warnings: prepared.inputQa.warnings,
      stats: prepared.inputQa.stats,
    } : null,
    outputQa: prepared ? {
      publishable: prepared.outputQa.publishable,
      errors: prepared.outputQa.errors,
      warnings: prepared.outputQa.warnings,
      stats: prepared.outputQa.stats,
    } : null,
    surgical: surgical ? {
      date: surgical.timing.date,
      start: surgical.timing.start_time,
      end: surgical.timing.end_time,
      locations: surgical.lesson.locations,
      sourceFile: surgical.source.file_name,
      type: surgical.lesson.type,
    } : null,
    may11,
    leakedElectives: candidate?.events?.filter((event) => lecture.choiceRequired?.options?.some(
      (option) => option.discipline === event.lesson.discipline.normalized,
    )).map((event) => ({ date: event.timing.date, discipline: event.lesson.discipline.normalized })) || [],
  },
};

console.log('IZHGMU_LECTURE_DIAG', JSON.stringify(diagnostic));
await fs.writeFile(path.join(inputDir, 'lecture-diagnostic.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
