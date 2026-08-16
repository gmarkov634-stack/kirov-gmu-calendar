import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import { buildIzhgmuWeeklyLectureElectiveCatalog } from '../src/adapters/izhgmu/weekly-lecture-elective-catalog.mjs';
import { assessIzhgmuWeeklyLecturePersonalizationReadiness } from '../src/adapters/izhgmu/weekly-lecture-personalization-readiness.mjs';
import { izhgmuWeeklyLectureBlockers } from '../src/adapters/izhgmu/canonical.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function norm(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function sourcePair(report, stream) {
  const items = report.files.filter((item) => item.status === 'downloaded'
    && item.spreadsheetKind === 'xlsx'
    && item.faculty === 'medicine'
    && Number(item.course) === 1
    && String(item.stream ?? '') === String(stream)
    && item.language === 'ru'
    && item.term === 'spring');
  const classSource = items.find((item) => item.sourceKind === 'class');
  const lectureSource = items.find((item) => item.sourceKind === 'lecture');
  if (!classSource || !lectureSource) throw new Error(`medicine-1 source pair missing for stream ${stream}`);
  return { classSource, lectureSource };
}
function groupCodes(structure) {
  const sheet = structure.sheets.find((item) => item.name.toLowerCase().includes('расписание'));
  const candidates = sheet.cells.filter((cell) => /^\d{3}$/.test(norm(cell.value)) && cell.row <= 10);
  const byRow = new Map();
  for (const cell of candidates) {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  }
  const groups = ([...byRow.values()].sort((a, b) => b.length - a.length)[0] || [])
    .sort((a, b) => a.col - b.col).map((cell) => norm(cell.value));
  if (groups.length !== 10) throw new Error(`medicine-1 group header changed: ${JSON.stringify(groups)}`);
  return groups;
}
function academicYearFromPeriod(period) {
  const [yearRaw, monthRaw] = String(period?.start_date || '').split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error('medicine-1 period missing');
  const start = month >= 8 ? year : year - 1;
  return `${start}/${start + 1}`;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine1-readiness.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const groupsReport = [];

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = sourcePair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) {
    throw new Error(`stream ${stream}: source SHA mismatch`);
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
  const source = {
    classFileName: classSource.filename,
    classFileHash: classSource.sha256,
    companionFileName: lectureSource.filename,
    companionFileHash: lectureSource.sha256,
  };
  const academicYear = academicYearFromPeriod(representativeWeekly.period);

  for (const groupCode of groups) {
    const weeklyParsed = groupCode === groups[0]
      ? representativeWeekly
      : parseIzhgmuWeeklyStructures({ classStructure, companionStructure: lectureStructure, groupCode });
    const combined = composeIzhgmuWeeklyLecture({ weeklyParsed, lectureParsed });
    const metadata = { academicYear, semester: 'spring', facultyCode: 'medicine', course: 1, groupCode, stream };
    const catalog = buildIzhgmuWeeklyLectureElectiveCatalog({
      weeklyParsed,
      lectureParsed,
      metadata,
      source,
      now: '2026-08-16T00:00:00.000Z',
    });
    const blockers = izhgmuWeeklyLectureBlockers(combined);
    const nonElective = blockers.filter((item) => item.warning !== 'elective_choice_required');
    const unexpected = nonElective.filter((item) => (
      item.warning !== 'end_time_missing_in_source'
      || norm(item.discipline).toLowerCase() !== 'кураторский час'
    ));
    if (unexpected.length) {
      const error = new Error(`${groupCode}: unexpected non-personalization blocker`);
      error.code = 'IZH_MEDICINE1_UNEXPECTED_BLOCKER';
      error.blockers = unexpected;
      throw error;
    }

    let readiness;
    if (nonElective.length) {
      try {
        assessIzhgmuWeeklyLecturePersonalizationReadiness(combined, catalog);
        throw new Error(`${groupCode}: readiness unexpectedly passed with curator blocker`);
      } catch (error) {
        if (error.code !== 'IZH_PERSONALIZATION_CONTENT_BLOCKED') throw error;
      }
      readiness = 'blocked_by_source';
    } else {
      const assessed = assessIzhgmuWeeklyLecturePersonalizationReadiness(combined, catalog);
      if (!assessed.contentReady || assessed.productionAuthorized !== false) {
        throw new Error(`${groupCode}: invalid readiness result`);
      }
      readiness = 'content_ready';
    }

    groupsReport.push({
      groupCode,
      stream,
      readiness,
      productionAuthorized: false,
      blockerWarnings: [...new Set(blockers.map((item) => item.warning))].sort(),
      nonElectiveBlockers: nonElective.map((item) => ({ warning: item.warning, reference: item.reference, discipline: item.discipline })),
      electiveBlocks: catalog.electives.length,
      options: catalog.electives.reduce((sum, block) => sum + block.options.length, 0),
    });
  }
}

if (groupsReport.length !== 30) throw new Error(`expected 30 groups, got ${groupsReport.length}`);
const result = {
  version: 1,
  university: 'izhgmu',
  facultyCode: 'medicine',
  course: 1,
  productionAuthorized: false,
  groups: groupsReport.sort((a, b) => Number(a.groupCode) - Number(b.groupCode)),
  summary: {
    groups: groupsReport.length,
    contentReady: groupsReport.filter((item) => item.readiness === 'content_ready').length,
    blockedBySource: groupsReport.filter((item) => item.readiness === 'blocked_by_source').length,
    curatorBlockers: groupsReport.reduce((sum, item) => sum + item.nonElectiveBlockers.length, 0),
    productionAuthorized: false,
  },
};
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE1_READINESS', JSON.stringify(result.summary));
