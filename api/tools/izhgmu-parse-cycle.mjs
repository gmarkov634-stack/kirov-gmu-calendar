import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuCycleWorkbook } from '../src/adapters/izhgmu/cycle-parser.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const faculty = arg('--faculty', 'pediatrics');
const course = Number(arg('--course', '3'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const source = report.files.find((item) => item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === faculty
  && Number(item.course) === course
  && item.language === 'ru'
  && item.sourceKind === 'class');
if (!source) throw new Error(`IZH-CYCLE source missing for ${faculty}/${course}`);
const buffer = await fs.readFile(path.join(inputDir, source.filename));
if (sha256(buffer) !== source.sha256) throw new Error('IZH-CYCLE source SHA mismatch');

const parsed = await parseIzhgmuCycleWorkbook(buffer);
const first = parsed.series.filter((item) => item.groupSpan === '301-302');
console.log('IZHGMU_CYCLE_REAL', JSON.stringify({
  sourceFile: source.filename,
  profile: parsed.profile,
  period: parsed.period,
  stats: parsed.stats,
  groupSpans: parsed.groupSpans,
  firstGroup: first.map((item) => ({
    discipline: item.disciplineRaw,
    fillId: item.fillId,
    dates: item.dates.length,
    firstDate: item.dates[0],
    lastDate: item.dates.at(-1),
    status: item.status,
    warning: item.warning,
    metadataDepartment: item.metadataBlock?.department || null,
    timeRaw: item.metadataBlock?.timeRaw || null,
  })),
}));

if (parsed.profile !== 'IZH-CYCLE') throw new Error('IZH-CYCLE profile mismatch');
if (parsed.groupSpans.length !== 5) throw new Error(`IZH-CYCLE group span count changed: ${parsed.groupSpans.length}`);
if (first.length !== 10) throw new Error(`IZH-CYCLE first group segment count changed: ${first.length}`);
if (first.map((item) => item.disciplineCompact).join('|') !== 'вк|озз|пропеддетб|фармакология|лучдиагн|патанатом|факултер|основыфзож|иммунол|патофизиологг') {
  throw new Error(`IZH-CYCLE first group labels changed: ${first.map((item) => item.disciplineCompact).join('|')}`);
}
if (parsed.metadataBlocks.length !== 10) throw new Error(`IZH-CYCLE metadata block count changed: ${parsed.metadataBlocks.length}`);
if (parsed.publishable) throw new Error('IZH-CYCLE must stay fail-closed while metadata bindings are unresolved');
if (!parsed.reviewRequired.length) throw new Error('IZH-CYCLE expected metadata binding review was lost');
