import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuMedicine4CycleWorkbook } from '../src/adapters/izhgmu/cycle-medicine4.mjs';
import { parseIzhgmuMedicine4LectureWorkbook } from '../src/adapters/izhgmu/lecture-medicine4.mjs';

function arg(name, fallback = null) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const findSource = (kind, stream = null) => report.files.find((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 4
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === kind
  && (stream == null || Number(item.stream) === stream)
));
const cycleSource = findSource('class');
if (!cycleSource) throw new Error('IZH medicine-4 cycle source missing');
const cycleBuffer = await fs.readFile(path.join(inputDir, cycleSource.filename));
if (sha256(cycleBuffer) !== cycleSource.sha256) throw new Error('IZH medicine-4 cycle source SHA mismatch');
const cycle = await parseIzhgmuMedicine4CycleWorkbook(cycleBuffer, { groupCode: '401' });

const results = [];
for (const stream of [1, 2]) {
  const source = findSource('lecture', stream);
  if (!source) throw new Error(`IZH medicine-4 lecture stream ${stream} source missing`);
  const buffer = await fs.readFile(path.join(inputDir, source.filename));
  if (sha256(buffer) !== source.sha256) throw new Error(`IZH medicine-4 lecture stream ${stream} SHA mismatch`);
  const parsed = await parseIzhgmuMedicine4LectureWorkbook(buffer, { stream, period: cycle.period });
  const expectedRows = stream === 1 ? 14 : 15;
  if (parsed.stats.sourceRows !== expectedRows || parsed.stats.exactOccurrences !== 77 || parsed.stats.safeOccurrences !== 77 || parsed.stats.structuralReviewCount !== 0) {
    throw new Error(`IZH medicine-4 lecture stream ${stream} geometry changed: ${JSON.stringify(parsed.stats)}`);
  }
  if (parsed.blockers.length !== 1 || parsed.blockers[0].warning !== 'stream_group_mapping_required') {
    throw new Error(`IZH medicine-4 lecture stream ${stream} blocker boundary changed: ${JSON.stringify(parsed.blockers)}`);
  }
  if (parsed.series.some((item) => /\b[12]\s*п\.?$/i.test(item.discipline))) {
    throw new Error(`IZH medicine-4 stream suffix leaked into normalized discipline for stream ${stream}`);
  }
  results.push({
    stream,
    sourceFile: source.filename,
    sourceHash: source.sha256,
    stats: parsed.stats,
    blockers: parsed.blockers,
    periodMarkers: parsed.periodMarkers,
  });
}
console.log('IZHGMU_LECTURE_MEDICINE4_REAL', JSON.stringify({ cyclePeriod: cycle.period, streams: results }));
