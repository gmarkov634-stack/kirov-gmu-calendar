import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuMedicine5LectureWorkbook } from '../src/adapters/izhgmu/lecture-medicine5.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const sources = report.files.filter((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === 'medicine'
  && Number(item.course) === 5
  && item.language === 'ru'
  && item.term === 'spring'
  && item.sourceKind === 'lecture'
)).sort((left, right) => Number(left.stream || 0) - Number(right.stream || 0));

if (sources.length !== 2 || sources.map((item) => Number(item.stream)).join(',') !== '1,2') {
  throw new Error(`Expected medicine-5 lecture streams 1,2; got ${sources.map((item) => `${item.stream}:${item.filename}`).join(', ')}`);
}

const parsed = [];
for (const source of sources) {
  const buffer = await fs.readFile(path.join(inputDir, source.filename));
  if (sha256(buffer) !== source.sha256) throw new Error(`Medicine-5 lecture SHA mismatch: ${source.filename}`);
  const result = await parseIzhgmuMedicine5LectureWorkbook(buffer, { expectedStream: Number(source.stream) });
  parsed.push({ source, result });
}

const expected = new Map([
  [1, { sourceRows: 13, coreSeries: 11, coreOccurrences: 76, electiveSeries: 2, electiveOccurrences: 7, electiveOptionCount: 6 }],
  [2, { sourceRows: 13, coreSeries: 11, coreOccurrences: 75, electiveSeries: 2, electiveOccurrences: 7, electiveOptionCount: 0 }],
]);
const expectedDisciplines = [
  'Акушерство',
  'Госпитальная терапия',
  'Госпитальная хирургия',
  'Избр. вопр. терапии',
  'Инфекционные болезни',
  'Мед-прав. основы',
  'Поликлиническая терапия',
  'Травматология',
].sort();

for (const { result } of parsed) {
  if (result.period.start_date !== '2026-02-16' || result.period.end_date !== '2026-06-20') {
    throw new Error(`Medicine-5 lecture period changed for stream ${result.stream}: ${result.period.start_date}..${result.period.end_date}`);
  }
  const stats = expected.get(result.stream);
  for (const [key, value] of Object.entries(stats)) {
    if (result.stats[key] !== value) throw new Error(`Medicine-5 lecture stream ${result.stream} ${key} changed: ${result.stats[key]}/${value}`);
  }
  if (result.stats.structuralReviewCount !== 0 || result.reviewRequired.length !== 0 || result.sourceLevelReady !== true) {
    throw new Error(`Medicine-5 lecture stream ${result.stream} structural review changed: ${JSON.stringify(result.reviewRequired)}`);
  }
  if (result.publishable !== false || result.groupMappingRequired?.warning !== 'stream_group_mapping_required') {
    throw new Error(`Medicine-5 lecture stream ${result.stream} must remain group-unmapped and fail-closed`);
  }
  if (result.choiceRequired?.warning !== 'elective_choice_required') {
    throw new Error(`Medicine-5 lecture stream ${result.stream} elective gate missing`);
  }
  const disciplines = [...new Set(result.safeCoreSeries.map((item) => item.discipline))].sort();
  if (disciplines.join('|') !== expectedDisciplines.join('|')) {
    throw new Error(`Medicine-5 lecture stream ${result.stream} discipline set changed: ${disciplines.join(', ')}`);
  }
  if (result.safeCoreSeries.some((item) => item.group != null || item.groups?.length)) {
    throw new Error(`Medicine-5 lecture stream ${result.stream} leaked heuristic group attribution`);
  }
  for (const item of result.safeCoreSeries) {
    const expectedEnd = item.startTime === '13:00' ? '14:35' : item.startTime === '14:45' ? '16:20' : null;
    if (!expectedEnd || item.endTime !== expectedEnd) {
      throw new Error(`Medicine-5 lecture reviewed slot changed: ${item.startTime}-${item.endTime}`);
    }
    if (!item.ruleIds.includes('IZH-L5-04') || item.externalEvidence.length < 2) {
      throw new Error(`Medicine-5 lecture slot evidence missing for ${item.discipline}`);
    }
  }
}

const stream1 = parsed.find((item) => item.result.stream === 1).result;
const stream2 = parsed.find((item) => item.result.stream === 2).result;
const therapy1 = stream1.safeCoreSeries.find((item) => item.discipline === 'Избр. вопр. терапии');
if (!therapy1 || therapy1.startTime !== '13:00' || therapy1.endTime !== '14:35'
    || therapy1.dates.join(',') !== ['2026-03-23','2026-04-06','2026-04-20','2026-05-04','2026-05-18','2026-06-01','2026-06-15'].join(',')) {
  throw new Error(`Medicine-5 stream-1 selected-therapy lecture evidence changed: ${JSON.stringify(therapy1)}`);
}
const therapy2 = stream2.safeCoreSeries.find((item) => item.discipline === 'Избр. вопр. терапии');
if (!therapy2 || therapy2.startTime !== '14:45' || therapy2.endTime !== '16:20'
    || therapy2.dates.join(',') !== ['2026-02-20','2026-03-06','2026-03-20','2026-04-03','2026-04-17','2026-05-15','2026-05-29'].join(',')) {
  throw new Error(`Medicine-5 stream-2 selected-therapy lecture evidence changed: ${JSON.stringify(therapy2)}`);
}

const summary = {
  profile: 'IZH-LECTURE-MEDICINE5',
  period: stream1.period,
  streams: parsed.map(({ source, result }) => ({
    stream: result.stream,
    sourceFile: source.filename,
    sourceHash: source.sha256,
    stats: result.stats,
    safeCoreDisciplines: [...new Set(result.safeCoreSeries.map((item) => item.discipline))].sort(),
    blockers: [result.groupMappingRequired.warning, result.choiceRequired.warning],
  })),
  totalSafeCoreOccurrences: parsed.reduce((count, item) => count + item.result.stats.coreOccurrences, 0),
  totalExplicitElectiveOccurrences: parsed.reduce((count, item) => count + item.result.stats.electiveOccurrences, 0),
  structuralReviewCount: parsed.reduce((count, item) => count + item.result.stats.structuralReviewCount, 0),
  groupMappingStatus: 'unresolved',
  publishable: false,
};
await fs.writeFile(path.join(inputDir, 'medicine5-lecture-diagnostic.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log('IZHGMU_LECTURE_MEDICINE5_REAL', JSON.stringify(summary));
