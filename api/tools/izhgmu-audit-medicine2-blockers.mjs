import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';

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
  return {
    classSource: items.find((item) => item.sourceKind === 'class'),
    lectureSource: items.find((item) => item.sourceKind === 'lecture'),
  };
}

function aliasSoleSheet(structure) {
  if (structure.sheets.some((sheet) => sheet.name.toLowerCase().includes('расписание'))) return structure;
  if (structure.sheets.length !== 1) return structure;
  return { ...structure, sheets: [{ ...structure.sheets[0], name: `расписание (${structure.sheets[0].name})` }] };
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

function compact(item) {
  return {
    warning: item.warning || null,
    warnings: item.warnings || [],
    discipline: item.discipline || null,
    weekday: item.weekday ?? null,
    startTime: item.startTime || null,
    endTime: item.endTime || null,
    dates: item.dates || [],
    declaredCount: item.declaredCount ?? null,
    declaredCountScope: item.declaredCountScope || null,
    rawSource: item.rawSource || item.value || null,
    references: item.references || [],
    ruleIds: item.ruleIds || [],
  };
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine2-blocker-audit.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const out = { version: 1, course: 2, streams: [] };

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = pair(report, stream);
  if (!classSource || !lectureSource) throw new Error(`source pair missing stream ${stream}`);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) throw new Error(`SHA mismatch stream ${stream}`);
  const [classStructure, lectureStructure] = await Promise.all([readIzhgmuXlsxStructure(classBuffer), readIzhgmuXlsxStructure(lectureBuffer)]);
  const groupCodes = groups(classStructure);
  const representative = groupCodes[0];
  const weekly = parseIzhgmuWeeklyStructures({ classStructure, companionStructure: aliasSoleSheet(lectureStructure), groupCode: representative });
  const lecture = parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed: weekly });
  const combined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });
  const lectureWarnings = [...(lecture.safeSeries || []), ...(lecture.reviewRequired || [])]
    .filter((item) => item.status === 'needs_review' || (item.warnings || []).length)
    .map(compact);
  out.streams.push({
    stream,
    groups: groupCodes,
    representative,
    weeklyReview: (weekly.reviewRequired || []).map(compact),
    lectureReview: (lecture.reviewRequired || []).map(compact),
    lectureWarnings,
    classCoverage: lecture.classCoverage,
    combinedReview: (combined.reviewRequired || []).map(compact),
    combinedDeferred: (combined.deferred || []).map(compact),
  });
}

await fs.writeFile(output, `${JSON.stringify(out, null, 2)}\n`);
for (const stream of out.streams) {
  console.log('STREAM', stream.stream, 'REPRESENTATIVE', stream.representative);
  console.log('WEEKLY_REVIEW', JSON.stringify(stream.weeklyReview));
  console.log('LECTURE_REVIEW', JSON.stringify(stream.lectureReview));
  console.log('CLASS_COVERAGE', JSON.stringify(stream.classCoverage));
  console.log('COMBINED_REVIEW', JSON.stringify(stream.combinedReview));
  console.log('COMBINED_DEFERRED', JSON.stringify(stream.combinedDeferred));
}
