import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import { buildIzhgmuWeeklyLectureQaCandidate } from '../src/adapters/izhgmu/canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sourcePair(report, stream) {
  const matching = report.files.filter((item) => item.status === 'downloaded'
    && item.spreadsheetKind === 'xlsx'
    && item.faculty === 'medicine'
    && Number(item.course) === 2
    && String(item.stream ?? '') === String(stream)
    && item.language === 'ru'
    && item.term === 'spring');
  const classSource = matching.find((item) => item.sourceKind === 'class');
  const lectureSource = matching.find((item) => item.sourceKind === 'lecture');
  if (!classSource || !lectureSource) throw new Error(`medicine-2 source pair missing for stream ${stream}`);
  return { classSource, lectureSource };
}

function groupCodes(classStructure) {
  const sheet = classStructure.sheets.find((item) => item.name.toLowerCase().includes('расписание'));
  if (!sheet) throw new Error('medicine-2 class schedule sheet missing');
  const candidates = sheet.cells.filter((cell) => /^2\d{2}$/.test(norm(cell.value)) && cell.row <= 12);
  const rows = new Map();
  for (const cell of candidates) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  const selected = [...rows.values()].sort((a, b) => b.length - a.length)[0] || [];
  const groups = selected.sort((a, b) => a.col - b.col).map((cell) => norm(cell.value));
  if (!groups.length || new Set(groups).size !== groups.length) throw new Error(`medicine-2 group header ambiguous: ${JSON.stringify(groups)}`);
  return groups;
}

function summarizeWarnings(items = []) {
  const result = {};
  for (const item of items) {
    const warning = item.warning || 'unknown';
    result[warning] = (result[warning] || 0) + 1;
  }
  return result;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine2-diagnostic.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const result = { version: 1, status: 'diagnostic_only', course: 2, streams: [] };

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = sourcePair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) {
    throw new Error(`medicine-2 stream ${stream} source SHA mismatch`);
  }
  const [classStructure, lectureStructure] = await Promise.all([
    readIzhgmuXlsxStructure(classBuffer),
    readIzhgmuXlsxStructure(lectureBuffer),
  ]);
  const groups = groupCodes(classStructure);
  const groupReports = [];
  let lectureSummary = null;

  for (const groupCode of groups) {
    const weekly = parseIzhgmuWeeklyStructures({ classStructure, companionStructure: lectureStructure, groupCode });
    const lecture = parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed: weekly });
    const combined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });
    lectureSummary ||= {
      stats: lecture.stats,
      choiceBlocks: lecture.classCoverage?.choiceRequired?.map((item) => ({
        ref: item.ref,
        weekday: item.weekday,
        startTime: item.startTime,
        endTime: item.endTime,
        value: item.value,
      })) || [],
      unmapped: lecture.classCoverage?.unmapped || [],
    };

    const metadata = {
      academicYear: '2025/2026',
      semester: 'spring',
      facultyCode: 'medicine',
      course: 2,
      groupCode,
      stream,
    };
    const source = {
      classFileName: classSource.filename,
      classFileHash: classSource.sha256,
      companionFileName: lectureSource.filename,
      companionFileHash: lectureSource.sha256,
    };
    const qaCandidate = buildIzhgmuWeeklyLectureQaCandidate({ parsed: combined, metadata, source });
    let qaSafeEvents = null;
    let qaError = null;
    try {
      qaSafeEvents = prepareSchedulePublication(qaCandidate, { now: '2026-08-16T00:00:00.000Z' }).batch.events.length;
    } catch (error) {
      qaError = { code: error.code || null, message: error.message };
    }

    groupReports.push({
      groupCode,
      weeklySeries: weekly.series?.length || 0,
      combinedSeries: combined.series?.length || 0,
      reviewRequired: combined.reviewRequired?.length || 0,
      reviewWarnings: summarizeWarnings(combined.reviewRequired),
      unresolvedChoices: combined.unresolvedChoices?.length || 0,
      deferred: combined.deferred?.length || 0,
      publishable: combined.publishable,
      qaSafeEvents,
      qaError,
    });
  }

  result.streams.push({
    stream,
    classFile: classSource.filename,
    classSha256: classSource.sha256,
    lectureFile: lectureSource.filename,
    lectureSha256: lectureSource.sha256,
    groups,
    lecture: lectureSummary,
    groupsDiagnostic: groupReports,
  });
}

result.summary = {
  groupCount: result.streams.reduce((sum, item) => sum + item.groups.length, 0),
  streams: result.streams.length,
  allGroups: result.streams.flatMap((item) => item.groups),
  blockerWarnings: result.streams.flatMap((item) => item.groupsDiagnostic).reduce((acc, item) => {
    for (const [key, value] of Object.entries(item.reviewWarnings)) acc[key] = (acc[key] || 0) + value;
    return acc;
  }, {}),
  groupsWithReview: result.streams.flatMap((item) => item.groupsDiagnostic).filter((item) => item.reviewRequired > 0).length,
  groupsWithChoices: result.streams.flatMap((item) => item.groupsDiagnostic).filter((item) => item.unresolvedChoices > 0).length,
  groupsWithDeferred: result.streams.flatMap((item) => item.groupsDiagnostic).filter((item) => item.deferred > 0).length,
};

await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE2_DIAGNOSTIC', JSON.stringify(result.summary));
for (const item of result.streams) {
  console.log('STREAM', item.stream, 'GROUPS', item.groups.join(','));
  console.log('LECTURE_STATS', JSON.stringify(item.lecture?.stats || {}));
  console.log('CHOICE_BLOCKS', JSON.stringify(item.lecture?.choiceBlocks || []));
  console.log('UNMAPPED', JSON.stringify(item.lecture?.unmapped || []));
  console.log('GROUP_DIAGNOSTICS', JSON.stringify(item.groupsDiagnostic));
}
