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
import { buildIzhgmuWeeklyLectureQaCandidate } from '../src/adapters/izhgmu/canonical.mjs';
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

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine2-normalized.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const result = { version: 1, course: 2, streams: [] };

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
    const combined = normalizeIzhgmuMedicine2Combined(rawCombined);
    const metadata = { academicYear: '2025/2026', semester: 'spring', facultyCode: 'medicine', course: 2, groupCode, stream };
    const source = { classFileName: classSource.filename, classFileHash: classSource.sha256, companionFileName: lectureSource.filename, companionFileHash: lectureSource.sha256 };
    const candidate = buildIzhgmuWeeklyLectureQaCandidate({ parsed: combined, metadata, source });
    const publication = prepareSchedulePublication(candidate, { now: '2026-08-16T00:00:00.000Z' });
    groupResults.push({
      groupCode,
      publishable: combined.publishable,
      events: publication.batch.events.length,
      reviewRequired: combined.reviewRequired.length,
      reviewWarnings: warningCounts(combined.reviewRequired),
      deferred: combined.deferred.length,
      annotations: combined.informationalAnnotations?.length || 0,
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
  warnings: all.reduce((acc, item) => {
    for (const [key, value] of Object.entries(item.reviewWarnings)) acc[key] = (acc[key] || 0) + value;
    return acc;
  }, {}),
};

await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE2_NORMALIZED', JSON.stringify(result.summary));
for (const item of result.streams) {
  console.log('STREAM', item.stream, JSON.stringify(item.groupResults));
}
