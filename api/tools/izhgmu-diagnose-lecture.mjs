import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuWeeklyPair } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLecturePair } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import { izhgmuWeeklyLectureBlockers } from '../src/adapters/izhgmu/canonical.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
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
};

console.log('IZHGMU_LECTURE_DIAG', JSON.stringify(diagnostic));
await fs.writeFile(path.join(inputDir, 'lecture-diagnostic.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
