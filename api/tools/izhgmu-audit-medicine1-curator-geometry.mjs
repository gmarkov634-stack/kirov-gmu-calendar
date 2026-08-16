import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function parseRef(range) {
  const cell = String(range || '').split('!').at(-1);
  const match = cell.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = col * 26 + char.charCodeAt(0) - 64;
  return { ref: cell, row: Number(match[2]), col };
}
function clockRange(value) {
  const match = norm(value).match(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  return {
    start: `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`,
    end: `${String(Number(match[3])).padStart(2, '0')}:${match[4]}`,
  };
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
function groupCodes(structure) {
  const sheet = structure.sheets.find((item) => item.name.toLowerCase().includes('расписание'));
  const candidates = sheet.cells.filter((cell) => /^\d{3}$/.test(norm(cell.value)) && cell.row <= 10);
  const byRow = new Map();
  for (const cell of candidates) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  return ([...byRow.values()].sort((a, b) => b.length - a.length)[0] || [])
    .sort((a, b) => a.col - b.col).map((cell) => norm(cell.value));
}
function structuralTimeCells(sheet, row) {
  const result = [];
  for (const cell of sheet.cells.filter((entry) => entry.col === 2)) {
    const range = clockRange(cell.value);
    if (!range) continue;
    const merge = sheet.merges.find((item) => item.startRef === cell.ref);
    const startRow = cell.row;
    const endRow = merge?.endRow ?? cell.row;
    if (row < startRow || row > endRow) continue;
    result.push({
      ref: cell.ref,
      value: norm(cell.value),
      startRow,
      endRow,
      merge: merge?.ref ?? null,
      ...range,
    });
  }
  return result;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine1-curator-geometry.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const records = [];

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = sourcePair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) {
    throw new Error(`stream ${stream}: source SHA mismatch`);
  }
  const [classStructure, lectureStructure] = await Promise.all([
    readIzhgmuXlsxStructure(classBuffer),
    readIzhgmuXlsxStructure(lectureBuffer),
  ]);
  const sheet = classStructure.sheets.find((item) => item.name.toLowerCase().includes('расписание'));
  for (const groupCode of groupCodes(classStructure)) {
    const parsed = parseIzhgmuWeeklyStructures({ classStructure, companionStructure: lectureStructure, groupCode });
    for (const blocker of parsed.reviewRequired.filter((item) => item.warning === 'end_time_missing_in_source')) {
      const pointer = parseRef(blocker.references?.[0]?.range);
      if (!pointer) throw new Error(`${groupCode}: invalid blocker reference`);
      const geometry = structuralTimeCells(sheet, pointer.row);
      records.push({
        stream,
        groupCode,
        reference: blocker.references?.[0]?.range || null,
        rawSource: norm(blocker.rawSource),
        startTime: blocker.startTime,
        row: pointer.row,
        columnB: sheet.cells.filter((item) => item.row === pointer.row && item.col === 2).map((item) => ({ ref: item.ref, value: norm(item.value) })),
        structuralTimeCells: geometry,
        exactStartMatches: geometry.filter((item) => item.start === blocker.startTime),
      });
    }
  }
}

const directlyResolved = records.filter((item) => item.exactStartMatches.length === 1);
const ambiguous = records.filter((item) => item.exactStartMatches.length > 1);
const absent = records.filter((item) => item.exactStartMatches.length === 0);
const result = {
  version: 1,
  status: 'diagnostic_only',
  records,
  summary: {
    blockers: records.length,
    directStructuralMatches: directlyResolved.length,
    ambiguousStructuralMatches: ambiguous.length,
    noStructuralMatch: absent.length,
    directMatches: directlyResolved.map((item) => ({
      groupCode: item.groupCode,
      reference: item.reference,
      startTime: item.startTime,
      structural: item.exactStartMatches[0],
    })),
  },
};
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE1_CURATOR_GEOMETRY', JSON.stringify(result.summary));
for (const item of records) {
  console.log('CURATOR_GEOMETRY', JSON.stringify({
    groupCode: item.groupCode,
    reference: item.reference,
    startTime: item.startTime,
    columnB: item.columnB,
    structuralTimeCells: item.structuralTimeCells,
    exactStartMatches: item.exactStartMatches,
  }));
}
