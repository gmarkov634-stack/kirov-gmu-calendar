import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuMedicine5CycleWorkbook } from '../src/adapters/izhgmu/cycle-medicine5.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const source = report.files.find((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 5
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === 'class'
));
if (!source) throw new Error('Medicine-5 class source missing');
const buffer = await fs.readFile(path.join(inputDir, source.filename));
if (sha256(buffer) !== source.sha256) throw new Error('Medicine-5 class source SHA mismatch');

const parsed = await parseIzhgmuMedicine5CycleWorkbook(buffer, { groupCode: '501' });
const glossaryDisciplines = new Set(['Избр. вопр. терапии', 'Мед-прав. основы']);
for (const series of parsed.series) {
  const hasC12 = series.ruleIds.includes('IZH-C12');
  if (glossaryDisciplines.has(series.discipline) !== hasC12) {
    throw new Error(`IZH-C12 provenance scope mismatch for ${series.discipline}: ${JSON.stringify(series.ruleIds)}`);
  }
}
const withC12 = parsed.series.filter((series) => series.ruleIds.includes('IZH-C12')).map((series) => series.discipline).sort();
if (withC12.join('|') !== [...glossaryDisciplines].sort().join('|')) {
  throw new Error(`IZH-C12 must cover exactly two companion-confirmed abbreviations: ${withC12.join(', ')}`);
}
console.log('IZHGMU_CYCLE_MEDICINE5_PROVENANCE', JSON.stringify({ rule: 'IZH-C12', disciplines: withC12 }));
