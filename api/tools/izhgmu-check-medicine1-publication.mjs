import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import { buildIzhgmuWeeklyLectureQaCandidate } from '../src/adapters/izhgmu/canonical.mjs';
import { buildIzhgmuWeeklyLectureElectiveCatalog } from '../src/adapters/izhgmu/weekly-lecture-elective-catalog.mjs';
import { publishScheduleBatch } from '../src/schedule/pipeline.js';
import { schedulePersonalizationMatchesSchedule } from '../src/schedule/personalization-publication.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function findSource(report, kind) {
  const item = report.files.find((source) => source.status === 'downloaded'
    && source.faculty === 'medicine'
    && Number(source.course) === 1
    && String(source.stream) === '1'
    && source.language === 'ru'
    && source.term === 'spring'
    && source.sourceKind === kind
    && source.spreadsheetKind === 'xlsx');
  if (!item) throw new Error(`medicine-1 stream-1 ${kind} source missing`);
  return item;
}

class PublicationProbeStore {
  constructor() {
    this.schedule = null;
    this.catalog = null;
    this.writes = [];
  }

  async getSchedule() {
    return this.schedule;
  }

  async putSchedulePersonalization(_input, catalog) {
    this.writes.push('personalization');
    this.catalog = structuredClone(catalog);
  }

  async putSchedule(batch) {
    this.writes.push('schedule');
    this.schedule = structuredClone(batch);
    return { unchanged: false, probe: true };
  }
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const classSource = findSource(report, 'class');
const lectureSource = findSource(report, 'lecture');
const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) {
  throw new Error('medicine-1 publication probe source SHA mismatch');
}

const [classStructure, lectureStructure] = await Promise.all([
  readIzhgmuXlsxStructure(classBuffer),
  readIzhgmuXlsxStructure(lectureBuffer),
]);
const weekly = parseIzhgmuWeeklyStructures({
  classStructure,
  companionStructure: lectureStructure,
  groupCode: '109',
});
const lecture = parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed: weekly });
const combined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });
const metadata = {
  academicYear: '2025/2026',
  semester: 'spring',
  facultyCode: 'medicine',
  course: 1,
  groupCode: '109',
  stream: '1',
};
const source = {
  classFileName: classSource.filename,
  classFileHash: classSource.sha256,
  companionFileName: lectureSource.filename,
  companionFileHash: lectureSource.sha256,
};
const base = buildIzhgmuWeeklyLectureQaCandidate({ parsed: combined, metadata, source });
const rawCatalog = buildIzhgmuWeeklyLectureElectiveCatalog({
  weeklyParsed: weekly,
  lectureParsed: lecture,
  metadata,
  source,
  now: '2026-08-16T00:00:00.000Z',
});
const store = new PublicationProbeStore();
let eventCounter = 0;
const result = await publishScheduleBatch({
  store,
  incomingBatch: base,
  personalizationCatalog: rawCatalog,
  now: '2026-08-16T00:00:00.000Z',
  eventIdFactory: () => `evt_izh_pub_${++eventCounter}`,
  versionIdFactory: () => 'ver_izh_pub_109',
});

if (store.writes.join(',') !== 'personalization,schedule') {
  throw new Error(`personalization publication write order changed: ${store.writes.join(',')}`);
}
if (!result.personalization?.published || result.personalization.electiveBlocks !== 1) {
  throw new Error('personalization sidecar was not published with base schedule');
}
if (!schedulePersonalizationMatchesSchedule(store.schedule, store.catalog)) {
  throw new Error('stored personalization sidecar does not match current base schedule');
}
if (store.catalog.baseSchedule.scheduleVersionId !== store.schedule.schedule.schedule_version_id
    || store.catalog.baseSchedule.contentFingerprint !== store.schedule.schedule.content_fingerprint) {
  throw new Error('stored personalization binding does not use published version/fingerprint');
}

const staleBase = structuredClone(store.schedule);
staleBase.schedule.schedule_version_id = 'ver_izh_pub_109_next';
staleBase.schedule.content_fingerprint = 'sha256:changed-base';
if (schedulePersonalizationMatchesSchedule(staleBase, store.catalog)) {
  throw new Error('stale personalization sidecar matched a different base schedule');
}

const summary = {
  status: 'ok',
  group: '109',
  baseEvents: store.schedule.events.length,
  electiveBlocks: store.catalog.electives.length,
  options: store.catalog.electives[0].options.length,
  scheduleVersionId: store.schedule.schedule.schedule_version_id,
  contentFingerprint: store.schedule.schedule.content_fingerprint,
  writeOrder: store.writes,
  staleSidecarRejected: true,
};
console.log('IZHGMU_MEDICINE1_PUBLICATION_REAL', JSON.stringify(summary));
