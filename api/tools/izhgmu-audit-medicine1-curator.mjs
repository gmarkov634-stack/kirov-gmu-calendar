import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';

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
  const items = report.files.filter((item) => item.status === 'downloaded'
    && item.spreadsheetKind === 'xlsx'
    && item.faculty === 'medicine'
    && Number(item.course) === 1
    && String(item.stream ?? '') === String(stream)
    && item.language === 'ru'
    && item.term === 'spring');
  const classSource = items.find((item) => item.sourceKind === 'class');
  const lectureSource = items.find((item) => item.sourceKind === 'lecture');
  if (!classSource || !lectureSource) throw new Error(`medicine-1 source pair missing for stream ${stream}`);
  return { classSource, lectureSource };
}

function groupCodes(classStructure) {
  const sheet = classStructure.sheets.find((item) => item.name.toLowerCase().includes('расписание'));
  const candidates = sheet.cells.filter((cell) => /^\d{3}$/.test(norm(cell.value)) && cell.row <= 10);
  const byRow = new Map();
  for (const cell of candidates) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  const selected = [...byRow.values()].sort((a, b) => b.length - a.length)[0] || [];
  return selected.sort((a, b) => a.col - b.col).map((cell) => norm(cell.value));
}

function parseRef(range) {
  const cell = String(range || '').split('!').at(-1);
  const match = cell.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = col * 26 + char.charCodeAt(0) - 64;
  return { ref: cell, row: Number(match[2]), col };
}

function startOnly(value) {
  const match = norm(value).match(/^(\d{1,2})[.:](\d{2})\b/);
  return match ? `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` : null;
}

function fullRange(value) {
  const match = norm(value).match(/^(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  return {
    start: `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`,
    end: `${String(Number(match[3])).padStart(2, '0')}:${match[4]}`,
    raw: match[0],
  };
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine1-curator-audit.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const result = { version: 1, status: 'diagnostic_only', streams: [], uniqueBlockers: [] };
const unique = new Map();

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = sourcePair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) {
    throw new Error(`stream ${stream} source SHA mismatch`);
  }
  const [classStructure, lectureStructure] = await Promise.all([
    readIzhgmuXlsxStructure(classBuffer),
    readIzhgmuXlsxStructure(lectureBuffer),
  ]);
  const sheet = classStructure.sheets.find((item) => item.name.toLowerCase().includes('расписание'));
  const groups = groupCodes(classStructure);
  const blockers = [];

  for (const groupCode of groups) {
    const parsed = parseIzhgmuWeeklyStructures({
      classStructure,
      companionStructure: lectureStructure,
      groupCode,
    });
    for (const item of parsed.reviewRequired.filter((entry) => entry.warning === 'end_time_missing_in_source')) {
      const pointer = parseRef(item.references?.[0]?.range);
      const cell = pointer ? sheet.cells.find((entry) => entry.row === pointer.row && entry.col === pointer.col) : null;
      const start = startOnly(cell?.value || item.rawSource);
      const sameRow = pointer
        ? sheet.cells.filter((entry) => entry.row === pointer.row && norm(entry.value)).map((entry) => ({ ref: entry.ref, value: norm(entry.value) }))
        : [];
      const sameStartRanges = start
        ? sheet.cells.map((entry) => ({ ref: entry.ref, value: norm(entry.value), range: fullRange(entry.value) }))
          .filter((entry) => entry.range?.start === start)
          .map((entry) => ({ ref: entry.ref, value: entry.value, end: entry.range.end }))
        : [];
      const record = {
        stream,
        groupCode,
        sourceFile: classSource.filename,
        sourceSha256: classSource.sha256,
        reference: item.references?.[0]?.range || null,
        rawSource: norm(item.rawSource),
        discipline: norm(item.discipline),
        startTime: item.startTime || start,
        endTime: item.endTime || null,
        weekday: item.weekday || null,
        row: pointer?.row || null,
        sameRow,
        fullRangesWithSameStart: sameStartRanges,
      };
      blockers.push(record);
      const identity = `${classSource.sha256}|${record.reference}|${record.rawSource}`;
      if (!unique.has(identity)) unique.set(identity, { ...record, groups: [] });
      unique.get(identity).groups.push(groupCode);
    }
  }

  result.streams.push({ stream, groups, blockerCount: blockers.length, blockers });
}

result.uniqueBlockers = [...unique.values()].map((item) => ({
  ...item,
  groups: [...new Set(item.groups)].sort((a, b) => Number(a) - Number(b)),
}));
result.summary = {
  groupBlockerOccurrences: result.streams.reduce((sum, item) => sum + item.blockerCount, 0),
  uniqueSourceCells: result.uniqueBlockers.length,
  candidateExactEndSets: result.uniqueBlockers.map((item) => ({
    stream: item.stream,
    reference: item.reference,
    startTime: item.startTime,
    exactEndsSeenElsewhere: [...new Set(item.fullRangesWithSameStart.map((entry) => entry.end))].sort(),
  })),
};
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE1_CURATOR_AUDIT', JSON.stringify(result.summary));
for (const item of result.uniqueBlockers) {
  console.log('CURATOR_SOURCE_CELL', JSON.stringify({
    stream: item.stream,
    groups: item.groups,
    reference: item.reference,
    rawSource: item.rawSource,
    startTime: item.startTime,
    sameRow: item.sameRow,
    fullRangesWithSameStart: item.fullRangesWithSameStart,
  }));
}
