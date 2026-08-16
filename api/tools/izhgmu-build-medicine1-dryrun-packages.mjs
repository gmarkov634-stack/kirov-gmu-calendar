import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import {
  buildIzhgmuWeeklyLectureQaCandidate,
  izhgmuWeeklyLectureBlockers,
} from '../src/adapters/izhgmu/canonical.mjs';
import { buildIzhgmuWeeklyLectureElectiveCatalog } from '../src/adapters/izhgmu/weekly-lecture-elective-catalog.mjs';
import { publishScheduleBatch } from '../src/schedule/pipeline.js';
import { schedulePersonalizationMatchesSchedule } from '../src/schedule/personalization-publication.js';
import {
  projectScheduleForSubscription,
  updateSubscriptionElectivePreferences,
} from '../src/subscription-personalization.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sourcePair(report, stream) {
  const matching = report.files.filter((item) => (
    item.status === 'downloaded'
    && item.spreadsheetKind === 'xlsx'
    && item.faculty === 'medicine'
    && Number(item.course) === 1
    && String(item.stream ?? '') === String(stream)
    && item.language === 'ru'
    && item.term === 'spring'
  ));
  const classSource = matching.find((item) => item.sourceKind === 'class');
  const lectureSource = matching.find((item) => item.sourceKind === 'lecture');
  if (!classSource || !lectureSource) throw new Error(`medicine-1 source pair missing for stream ${stream}`);
  return { classSource, lectureSource };
}

function groupCodes(classStructure) {
  const sheet = classStructure?.sheets?.find((item) => item.name.toLowerCase().includes('расписание'));
  if (!sheet) throw new Error('medicine-1 class sheet missing');
  const candidates = sheet.cells.filter((cell) => /^\d{3}$/.test(String(cell.value ?? '').trim()) && cell.row <= 10);
  const byRow = new Map();
  for (const cell of candidates) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  const selected = [...byRow.values()].sort((a, b) => b.length - a.length)[0] || [];
  const groups = selected.sort((a, b) => a.col - b.col).map((cell) => String(cell.value).trim());
  if (groups.length !== 10 || new Set(groups).size !== 10) {
    throw new Error(`medicine-1 group header changed: ${JSON.stringify(groups)}`);
  }
  return groups;
}

function academicYearFromPeriod(period) {
  const match = String(period?.start_date || '').match(/^(20\d{2})-(\d{2})-/);
  if (!match) throw new Error('medicine-1 semester period missing');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = month >= 8 ? year : year - 1;
  return `${start}/${start + 1}`;
}

class DryRunStore {
  constructor() {
    this.schedule = null;
    this.personalization = null;
    this.writeOrder = [];
  }

  async getSchedule() {
    return this.schedule;
  }

  async putSchedulePersonalization(_input, catalog) {
    this.writeOrder.push('personalization');
    this.personalization = structuredClone(catalog);
  }

  async putSchedule(batch) {
    this.writeOrder.push('schedule');
    this.schedule = structuredClone(batch);
    return { unchanged: false, dryRun: true };
  }
}

function assertProjection(base, catalog, option) {
  const block = catalog.electives[0];
  const subscription = updateSubscriptionElectivePreferences(
    { version: 2, status: 'active', preferences: { electives: {} } },
    catalog,
    { electives: { [block.id]: option.id } },
  );
  const projected = projectScheduleForSubscription(base, subscription, catalog);
  const selected = projected.events.filter((event) => event.lesson?.discipline?.normalized === option.officialDiscipline);
  if (selected.length !== option.events.length || option.events.length !== 26) {
    throw new Error(`${base.schedule.group}/${option.officialDiscipline}: projection count mismatch`);
  }
  const optionNames = new Set(block.options.map((item) => item.officialDiscipline));
  const leaked = projected.events.filter((event) => {
    const discipline = event.lesson?.discipline?.normalized;
    return optionNames.has(discipline) && discipline !== option.officialDiscipline;
  });
  if (leaked.length) throw new Error(`${base.schedule.group}/${option.officialDiscipline}: another elective leaked`);
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const outputDir = path.resolve(arg('--output-dir', '/tmp/izhgmu-medicine1-dryrun'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const manifest = {
  version: 1,
  university: 'izhgmu',
  facultyCode: 'medicine',
  course: 1,
  semester: 'spring',
  dryRun: true,
  productionAuthorized: false,
  safetyInvariant: 'QA-safe subset only; unresolved source blockers are preserved; no production store writes',
  generatedAt: '2026-08-16T00:00:00.000Z',
  groups: [],
};

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = sourcePair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) {
    throw new Error(`medicine-1 stream ${stream} source SHA mismatch`);
  }
  const [classStructure, lectureStructure] = await Promise.all([
    readIzhgmuXlsxStructure(classBuffer),
    readIzhgmuXlsxStructure(lectureBuffer),
  ]);
  const groups = groupCodes(classStructure);
  const representativeWeekly = parseIzhgmuWeeklyStructures({
    classStructure,
    companionStructure: lectureStructure,
    groupCode: groups[0],
  });
  const lectureParsed = parseIzhgmuLectureStructures({
    classStructure,
    lectureStructure,
    weeklyParsed: representativeWeekly,
  });
  const academicYear = academicYearFromPeriod(representativeWeekly.period);
  const source = {
    classFileName: classSource.filename,
    classFileHash: classSource.sha256,
    companionFileName: lectureSource.filename,
    companionFileHash: lectureSource.sha256,
  };

  for (const groupCode of groups) {
    const weeklyParsed = groupCode === groups[0]
      ? representativeWeekly
      : parseIzhgmuWeeklyStructures({ classStructure, companionStructure: lectureStructure, groupCode });
    const combined = composeIzhgmuWeeklyLecture({ weeklyParsed, lectureParsed });
    const blockers = izhgmuWeeklyLectureBlockers(combined);
    if (!blockers.length) {
      throw new Error(`${groupCode}: dry-run unexpectedly has no production blockers; review activation gate separately`);
    }
    if (!blockers.some((item) => item.warning === 'elective_choice_required')) {
      throw new Error(`${groupCode}: elective blocker disappeared before personalization`);
    }

    const metadata = {
      academicYear,
      semester: 'spring',
      facultyCode: 'medicine',
      course: 1,
      groupCode,
      stream,
    };
    const incomingBatch = buildIzhgmuWeeklyLectureQaCandidate({ parsed: combined, metadata, source });
    const rawCatalog = buildIzhgmuWeeklyLectureElectiveCatalog({
      weeklyParsed,
      lectureParsed,
      metadata,
      source,
      now: '2026-08-16T00:00:00.000Z',
    });
    if (rawCatalog.electives.length !== 1 || rawCatalog.electives[0].options.length !== 8) {
      throw new Error(`${groupCode}: elective catalog shape changed`);
    }

    const store = new DryRunStore();
    let eventCounter = 0;
    const result = await publishScheduleBatch({
      store,
      incomingBatch,
      personalizationCatalog: rawCatalog,
      now: '2026-08-16T00:00:00.000Z',
      eventIdFactory: () => `evt_izh_m1_${groupCode}_${++eventCounter}`,
      versionIdFactory: () => `ver_izh_m1_dryrun_${groupCode}`,
      postprocessOptions: { serviceName: 'Календарь ИжГМУ' },
    });
    if (store.writeOrder.join(',') !== 'personalization,schedule') {
      throw new Error(`${groupCode}: dry-run publication write order changed`);
    }
    if (!schedulePersonalizationMatchesSchedule(store.schedule, store.personalization)) {
      throw new Error(`${groupCode}: dry-run sidecar does not match generated base`);
    }
    const optionNames = new Set(store.personalization.electives[0].options.map((item) => item.officialDiscipline));
    if (store.schedule.events.some((event) => optionNames.has(event.lesson?.discipline?.normalized))) {
      throw new Error(`${groupCode}: unselected elective leaked into dry-run base`);
    }
    for (const option of store.personalization.electives[0].options) {
      assertProjection(store.schedule, store.personalization, option);
    }

    const groupDir = path.join(outputDir, groupCode);
    await fs.mkdir(groupDir, { recursive: true });
    const packageReport = {
      dryRun: true,
      productionAuthorized: false,
      stream,
      groupCode,
      source,
      blockers,
      baseEventCount: store.schedule.events.length,
      electiveBlocks: store.personalization.electives.length,
      electiveOptions: store.personalization.electives[0].options.length,
      eventsPerOption: store.personalization.electives[0].options.map((item) => ({
        id: item.id,
        officialDiscipline: item.officialDiscipline,
        eventCount: item.events.length,
      })),
      scheduleVersionId: store.schedule.schedule.schedule_version_id,
      contentFingerprint: store.schedule.schedule.content_fingerprint,
      sidecarMatchesBase: true,
      writeOrder: store.writeOrder,
    };
    await Promise.all([
      fs.writeFile(path.join(groupDir, 'schedule.json'), `${JSON.stringify(store.schedule, null, 2)}\n`),
      fs.writeFile(path.join(groupDir, 'personalization.json'), `${JSON.stringify(store.personalization, null, 2)}\n`),
      fs.writeFile(path.join(groupDir, 'report.json'), `${JSON.stringify(packageReport, null, 2)}\n`),
    ]);
    manifest.groups.push(packageReport);
  }
}

manifest.groups.sort((a, b) => Number(a.groupCode) - Number(b.groupCode));
if (manifest.groups.length !== 30) throw new Error(`expected 30 medicine-1 groups, got ${manifest.groups.length}`);
manifest.summary = {
  groups: manifest.groups.length,
  streams: [...new Set(manifest.groups.map((item) => item.stream))].length,
  totalBaseEvents: manifest.groups.reduce((sum, item) => sum + item.baseEventCount, 0),
  totalOptionEvents: manifest.groups.reduce((sum, item) => (
    sum + item.eventsPerOption.reduce((optionSum, option) => optionSum + option.eventCount, 0)
  ), 0),
  allSidecarsMatchBase: manifest.groups.every((item) => item.sidecarMatchesBase),
  productionAuthorized: false,
};
await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('IZHGMU_MEDICINE1_DRYRUN_PACKAGES', JSON.stringify(manifest.summary));
