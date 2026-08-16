import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import { buildIzhgmuWeeklyLectureQaCandidate } from '../src/adapters/izhgmu/canonical.mjs';
import { buildIzhgmuWeeklyLectureElectiveCatalog } from '../src/adapters/izhgmu/weekly-lecture-elective-catalog.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';
import { postprocessSchedule } from '../src/schedule/postprocess.js';
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
  if (!classSource || !lectureSource) {
    throw new Error(`IZH medicine-1 source pair missing for stream ${stream}`);
  }
  return { classSource, lectureSource };
}

function groupCodes(classStructure) {
  const sheet = classStructure?.sheets?.find((item) => item.name.toLowerCase().includes('расписание'));
  if (!sheet) throw new Error('IZH medicine-1 class sheet missing');
  const candidates = sheet.cells.filter((cell) => /^\d{3}$/.test(String(cell.value ?? '').trim()) && cell.row <= 10);
  const byRow = new Map();
  for (const cell of candidates) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  const selected = [...byRow.values()].sort((a, b) => b.length - a.length)[0] || [];
  const groups = selected.sort((a, b) => a.col - b.col).map((cell) => String(cell.value).trim());
  if (groups.length !== 10 || new Set(groups).size !== groups.length) {
    throw new Error(`IZH medicine-1 group header changed: ${JSON.stringify(groups)}`);
  }
  return groups;
}

function academicYearFromPeriod(period) {
  const start = String(period?.start_date || '').match(/^(20\d{2})-(\d{2})-/);
  if (!start) throw new Error('IZH medicine-1 semester period missing');
  const year = Number(start[1]);
  const month = Number(start[2]);
  const academicStart = month >= 8 ? year : year - 1;
  return `${academicStart}/${academicStart + 1}`;
}

const EXPECTED_OPTIONS = [
  'Актуальные вопросы Российского права',
  'Биофизика и основы информатики',
  'Введение в специальность',
  'Культурология',
  'Медицина и религия',
  'Медицинская химия',
  'Популяционная антропология',
  'Формирование ЗОЖ',
].sort((a, b) => a.localeCompare(b, 'ru'));

function optionNames(catalog) {
  return catalog.electives[0].options.map((item) => item.officialDiscipline).sort((a, b) => a.localeCompare(b, 'ru'));
}

function assertCatalog(catalog, groupCode, stream) {
  if (catalog.electives.length !== 1) {
    throw new Error(`IZH medicine-1 stream ${stream} group ${groupCode}: expected one logical elective, got ${catalog.electives.length}`);
  }
  if (catalog.electives[0].options.length !== 8) {
    throw new Error(`IZH medicine-1 stream ${stream} group ${groupCode}: expected 8 elective options`);
  }
  if (JSON.stringify(optionNames(catalog)) !== JSON.stringify(EXPECTED_OPTIONS)) {
    throw new Error(`IZH medicine-1 stream ${stream} group ${groupCode}: official elective option set changed`);
  }
  if (catalog.electives[0].sourceBlockRefs.length !== 2 || catalog.electives[0].practiceBlockRefs.length !== 1) {
    throw new Error(`IZH medicine-1 stream ${stream} group ${groupCode}: logical elective source geometry changed`);
  }
  for (const option of catalog.electives[0].options) {
    const lectures = option.events.filter((event) => event.lesson.type.code === 'lecture');
    const practices = option.events.filter((event) => event.lesson.type.code === 'practice');
    if (lectures.length !== 7 || practices.length !== 19 || option.events.length !== 26) {
      throw new Error(`IZH medicine-1 ${stream}/${groupCode}/${option.officialDiscipline}: expected 7 lectures + 19 practices, got ${lectures.length} + ${practices.length}`);
    }
    if (!option.events.every((event) => event.lesson.discipline.normalized === option.officialDiscipline)) {
      throw new Error(`IZH medicine-1 ${stream}/${groupCode}/${option.officialDiscipline}: neutralized elective title leaked`);
    }
    if (!option.events.every((event) => event.audience.group === String(groupCode))) {
      throw new Error(`IZH medicine-1 ${stream}/${groupCode}/${option.officialDiscipline}: event audience mismatch`);
    }
  }
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const streamReports = [];
let scenario109 = null;

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = sourcePair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256) throw new Error(`IZH medicine-1 stream ${stream} class SHA mismatch`);
  if (sha256(lectureBuffer) !== lectureSource.sha256) throw new Error(`IZH medicine-1 stream ${stream} lecture SHA mismatch`);

  const [classStructure, lectureStructure] = await Promise.all([
    readIzhgmuXlsxStructure(classBuffer),
    readIzhgmuXlsxStructure(lectureBuffer),
  ]);
  const groups = groupCodes(classStructure);
  const firstWeekly = parseIzhgmuWeeklyStructures({
    classStructure,
    companionStructure: lectureStructure,
    groupCode: groups[0],
  });
  const lecture = parseIzhgmuLectureStructures({
    classStructure,
    lectureStructure,
    weeklyParsed: firstWeekly,
  });
  if (lecture.classCoverage.choiceRequired.length !== 3 || lecture.stats.electiveOccurrences !== 56) {
    throw new Error(`IZH medicine-1 stream ${stream} elective source coverage changed`);
  }
  const academicYear = academicYearFromPeriod(firstWeekly.period);
  const sourceMetadata = {
    classFileName: classSource.filename,
    classFileHash: classSource.sha256,
    companionFileName: lectureSource.filename,
    companionFileHash: lectureSource.sha256,
  };

  let representative = null;
  for (const groupCode of groups) {
    const weekly = groupCode === groups[0]
      ? firstWeekly
      : parseIzhgmuWeeklyStructures({ classStructure, companionStructure: lectureStructure, groupCode });
    const metadata = {
      academicYear,
      semester: 'spring',
      facultyCode: 'medicine',
      course: 1,
      groupCode,
      stream,
    };
    const catalog = buildIzhgmuWeeklyLectureElectiveCatalog({
      weeklyParsed: weekly,
      lectureParsed: lecture,
      metadata,
      source: sourceMetadata,
      now: '2026-08-16T00:00:00.000Z',
    });
    assertCatalog(catalog, groupCode, stream);
    representative ||= catalog;

    if (groupCode === '109') {
      const combined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });
      const baseCandidate = buildIzhgmuWeeklyLectureQaCandidate({ parsed: combined, metadata, source: sourceMetadata });
      const preparedBase = prepareSchedulePublication(baseCandidate, { now: '2026-08-16T00:00:00.000Z' }).batch;
      if (preparedBase.events.some((event) => EXPECTED_OPTIONS.includes(event.lesson.discipline.normalized))) {
        throw new Error('IZH medicine-1 group 109 base calendar leaked an unselected elective');
      }

      const blockId = catalog.electives[0].id;
      const unselected = { version: 2, status: 'active', preferences: { electives: {} } };
      const unselectedProjection = projectScheduleForSubscription(preparedBase, unselected, catalog);
      if (unselectedProjection.events.length !== preparedBase.events.length) {
        throw new Error('IZH medicine-1 group 109 unselected elective changed base calendar');
      }

      const selected = updateSubscriptionElectivePreferences(unselected, catalog, {
        electives: { [blockId]: 'Культурология' },
      });
      const selectedProjection = postprocessSchedule(
        projectScheduleForSubscription(preparedBase, selected, catalog),
        { serviceName: 'Календарь ИжГМУ' },
      );
      const cultureEvents = selectedProjection.events.filter((event) => event.lesson.discipline.normalized === 'Культурология');
      if (cultureEvents.length !== 26
          || cultureEvents.filter((event) => event.lesson.type.code === 'lecture').length !== 7
          || cultureEvents.filter((event) => event.lesson.type.code === 'practice').length !== 19) {
        throw new Error('IZH medicine-1 group 109 selected Культурология projection is incomplete');
      }
      if (selectedProjection.events.some((event) => EXPECTED_OPTIONS.includes(event.lesson.discipline.normalized)
          && event.lesson.discipline.normalized !== 'Культурология')) {
        throw new Error('IZH medicine-1 group 109 projection leaked another elective option');
      }

      const cleared = updateSubscriptionElectivePreferences(selected, catalog, {
        electives: { [blockId]: null },
      });
      const clearedProjection = projectScheduleForSubscription(preparedBase, cleared, catalog);
      if (clearedProjection.events.some((event) => EXPECTED_OPTIONS.includes(event.lesson.discipline.normalized))) {
        throw new Error('IZH medicine-1 group 109 cleared elective remained in calendar');
      }
      scenario109 = {
        baseEvents: preparedBase.events.length,
        selectedEvents: selectedProjection.events.length,
        cultureEvents: cultureEvents.length,
        cultureLectures: cultureEvents.filter((event) => event.lesson.type.code === 'lecture').length,
        culturePractices: cultureEvents.filter((event) => event.lesson.type.code === 'practice').length,
        clearedEvents: clearedProjection.events.length,
      };
    }
  }

  streamReports.push({
    stream,
    groups,
    classFile: classSource.filename,
    lectureFile: lectureSource.filename,
    manifestAcademicYear: classSource.academicYear || null,
    sourceAcademicYear: academicYear,
    logicalElectives: representative.electives.length,
    optionCount: representative.electives[0].options.length,
    sourceBlockRefs: representative.electives[0].sourceBlockRefs,
    practiceBlockRefs: representative.electives[0].practiceBlockRefs,
    optionNames: optionNames(representative),
    eventsPerOption: representative.electives[0].options[0].events.length,
  });
}

if (!scenario109) throw new Error('IZH medicine-1 group 109 scenario was not exercised');
const result = {
  status: 'ok',
  sourceInvariant: 'one logical elective per stream; 8 official options; selected option materializes 7 lectures + 19 source-derived practices',
  streams: streamReports,
  scenario109,
};
await fs.writeFile(path.join(inputDir, 'medicine1-elective-personalization.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log('IZHGMU_MEDICINE1_ELECTIVES_REAL', JSON.stringify(result));
