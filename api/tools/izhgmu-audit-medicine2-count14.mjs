import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine2-count14-audit.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const lectureSource = report.files.find((item) => item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx' && item.faculty === 'medicine' && Number(item.course) === 2
  && String(item.stream ?? '') === '1' && item.language === 'ru' && item.term === 'spring'
  && item.sourceKind === 'lecture');
if (!lectureSource) throw new Error('medicine-2 stream-1 lecture source missing');
const structure = await readIzhgmuXlsxStructure(await fs.readFile(path.join(inputDir, lectureSource.filename)));
const sheet = structure.sheets[0];
const cells = sheet.cells
  .filter((cell) => cell.row <= 9 && cell.col >= 1 && cell.col <= 26 && norm(cell.value))
  .sort((a, b) => a.row - b.row || a.col - b.col)
  .map((cell) => ({ ref: cell.ref, row: cell.row, col: cell.col, value: norm(cell.value), rawValue: cell.value }));
const row8 = sheet.cells
  .filter((cell) => cell.row === 8 && cell.col >= 1 && cell.col <= 26 && norm(cell.value))
  .sort((a, b) => a.col - b.col)
  .map((cell) => ({ ref: cell.ref, col: cell.col, value: norm(cell.value) }));
const merges = sheet.merges.filter((merge) => merge.startRow <= 9 && merge.endRow >= 1);
const result = { source: lectureSource, sheet: sheet.name, cells, row8, merges };
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('COUNT14_HEADER_CELLS', JSON.stringify(cells));
console.log('COUNT14_ROW8', JSON.stringify(row8));
console.log('COUNT14_MERGES', JSON.stringify(merges));
