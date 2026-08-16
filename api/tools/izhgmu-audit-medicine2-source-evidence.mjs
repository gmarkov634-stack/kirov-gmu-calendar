import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';

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

function row(sheet, rowNumber) {
  return sheet.cells.filter((cell) => cell.row === rowNumber && norm(cell.value))
    .sort((a, b) => a.col - b.col)
    .map((cell) => ({ ref: cell.ref, value: norm(cell.value), rawValue: cell.value }));
}

function timeRanges(sheet) {
  const seen = new Map();
  for (const cell of sheet.cells.filter((item) => item.col === 2)) {
    const value = norm(cell.value);
    const m = value.match(/^(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})$/);
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    const key = `${String(Number(m[1])).padStart(2, '0')}:${m[2]}-${String(Number(m[3])).padStart(2, '0')}:${m[4]}`;
    if (!seen.has(key)) seen.set(key, { range: key, durationMinutes: end - start, refs: [] });
    seen.get(key).refs.push(cell.ref);
  }
  return [...seen.values()];
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine2-source-evidence.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const out = { version: 1, streams: [] };

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = pair(report, stream);
  if (!classSource || !lectureSource) throw new Error(`source pair missing ${stream}`);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) throw new Error(`SHA mismatch ${stream}`);
  const [classStructure, lectureStructure] = await Promise.all([readIzhgmuXlsxStructure(classBuffer), readIzhgmuXlsxStructure(lectureBuffer)]);
  const classSheet = classStructure.sheets[0];
  const lectureSheet = lectureStructure.sheets[0];
  const evidence = {
    stream,
    classFile: classSource.filename,
    lectureFile: lectureSource.filename,
    classTimeRanges: timeRanges(classSheet),
    rows: {},
  };
  if (stream === '1') {
    evidence.rows.lecture8 = row(lectureSheet, 8);
    evidence.rows.lecture20 = row(lectureSheet, 20);
  }
  if (stream === '2') {
    evidence.rows.class24 = row(classSheet, 24);
    evidence.rows.class25 = row(classSheet, 25);
    evidence.rows.class26 = row(classSheet, 26);
    evidence.rows.lecture20 = row(lectureSheet, 20);
  }
  if (stream === '3') {
    evidence.rows.class23 = row(classSheet, 23);
    evidence.rows.class24 = row(classSheet, 24);
    evidence.rows.class25 = row(classSheet, 25);
    evidence.rows.lecture20 = row(lectureSheet, 20);
  }
  out.streams.push(evidence);
}

await fs.writeFile(output, `${JSON.stringify(out, null, 2)}\n`);
for (const item of out.streams) {
  console.log('STREAM', item.stream, 'CLASS_TIME_RANGES', JSON.stringify(item.classTimeRanges));
  console.log('SOURCE_ROWS', JSON.stringify(item.rows));
}
