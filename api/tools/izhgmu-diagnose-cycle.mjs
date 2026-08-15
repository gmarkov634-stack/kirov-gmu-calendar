import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuCycleWorkbook } from '../src/adapters/izhgmu/cycle-parser.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const faculty = arg('--faculty', 'medicine');
const course = Number(arg('--course', '5'));
const outputName = arg('--output', `cycle-diagnostic-${faculty}-${course}.json`);

const downloadReport = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const candidates = downloadReport.files.filter((item) => (
  item.status === 'downloaded'
  && item.spreadsheetKind === 'xlsx'
  && item.faculty === faculty
  && Number(item.course) === course
  && item.language === 'ru'
  && item.sourceKind === 'class'
));
if (candidates.length !== 1) {
  throw new Error(`Expected exactly one downloaded CYCLE class source for ${faculty}/${course}; got ${candidates.length}`);
}
const source = candidates[0];
const buffer = await fs.readFile(path.join(inputDir, source.filename));
if (sha256(buffer) !== source.sha256) throw new Error('IZH-CYCLE diagnostic source SHA mismatch');

const parsed = await parseIzhgmuCycleWorkbook(buffer);
const report = {
  version: 1,
  university: 'izhgmu',
  purpose: 'cycle-structural-diagnostic-only',
  publishable: false,
  source: {
    filename: source.filename,
    sha256: source.sha256,
    faculty: source.faculty,
    course: source.course,
    academicYear: source.academicYear,
    term: source.term,
  },
  parser: {
    profile: parsed.profile,
    sourceSheet: parsed.sourceSheet,
    period: parsed.period,
    stats: parsed.stats,
    parserPublishable: parsed.publishable,
  },
  groupSpans: parsed.groupSpans,
  metadataBlocks: parsed.metadataBlocks.map((block) => ({
    index: block.index,
    range: block.range,
    department: block.department,
    timeRaw: block.timeRaw,
    controlRaw: block.controlRaw,
    locationRaw: block.locationRaw,
    fillId: block.fillId,
  })),
  groups: parsed.groupSpans.map((groupSpan) => ({
    groupSpan,
    series: parsed.series.filter((item) => item.groupSpan === groupSpan).map((item) => ({
      disciplineRaw: item.disciplineRaw,
      disciplineCompact: item.disciplineCompact,
      fillId: item.fillId,
      startCol: item.startCol,
      endCol: item.endCol,
      dateCount: item.dates.length,
      firstDate: item.dates[0] || null,
      lastDate: item.dates.at(-1) || null,
      dates: item.dates,
      status: item.status,
      warning: item.warning,
      metadataDepartment: item.metadataBlock?.department || null,
      timeRaw: item.metadataBlock?.timeRaw || null,
      controlRaw: item.metadataBlock?.controlRaw || null,
      locationRaw: item.metadataBlock?.locationRaw || null,
    })),
  })),
  review: parsed.reviewRequired.map((item) => ({
    groupSpan: item.groupSpan,
    disciplineRaw: item.disciplineRaw,
    fillId: item.fillId,
    dateCount: item.dates.length,
    firstDate: item.dates[0] || null,
    lastDate: item.dates.at(-1) || null,
    warning: item.warning,
  })),
};

await fs.writeFile(path.join(inputDir, outputName), `${JSON.stringify(report, null, 2)}\n`);
console.log('IZHGMU_CYCLE_DIAGNOSTIC', JSON.stringify({
  source: report.source,
  profile: report.parser.profile,
  period: report.parser.period,
  stats: report.parser.stats,
  groupSpans: report.groupSpans,
  metadata: report.metadataBlocks.map((item) => ({ department: item.department, timeRaw: item.timeRaw, fillId: item.fillId })),
  firstGroup: report.groups[0] || null,
  reviewCount: report.review.length,
  output: outputName,
}));
