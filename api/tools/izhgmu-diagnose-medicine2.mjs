import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';
import { parseIzhgmuWeeklyStructures } from '../src/adapters/izhgmu/weekly-parser.mjs';
import { parseIzhgmuLectureStructures } from '../src/adapters/izhgmu/lecture-parser.mjs';
import { composeIzhgmuWeeklyLecture } from '../src/adapters/izhgmu/weekly-lecture.mjs';
import { buildIzhgmuWeeklyLectureQaCandidate } from '../src/adapters/izhgmu/canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sourcePair(report, stream) {
  const matching = report.files.filter((item) => item.status === 'downloaded'
    && item.spreadsheetKind === 'xlsx'
    && item.faculty === 'medicine'
    && Number(item.course) === 2
    && String(item.stream ?? '') === String(stream)
    && item.language === 'ru'
    && item.term === 'spring');
  const classSource = matching.find((item) => item.sourceKind === 'class');
  const lectureSource = matching.find((item) => item.sourceKind === 'lecture');
  if (!classSource || !lectureSource) throw new Error(`medicine-2 source pair missing for stream ${stream}`);
  return { classSource, lectureSource };
}

function scheduleSheet(structure) {
  return structure.sheets.find((item) => item.name.toLowerCase().includes('расписание')) || structure.sheets[0] || null;
}

function groupCodes(classStructure) {
  const sheet = scheduleSheet(classStructure);
  if (!sheet) throw new Error('medicine-2 class sheet missing');
  const candidates = sheet.cells.filter((cell) => /^2\d{2}$/.test(norm(cell.value)) && cell.row <= 12);
  const rows = new Map();
  for (const cell of candidates) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  const selected = [...rows.values()].sort((a, b) => b.length - a.length)[0] || [];
  return selected.sort((a, b) => a.col - b.col).map((cell) => norm(cell.value));
}

function topology(structure) {
  return structure.sheets.map((sheet) => ({
    name: sheet.name,
    cells: sheet.cells.length,
    merges: sheet.merges.length,
    firstText: sheet.cells.filter((cell) => norm(cell.value)).slice(0, 18).map((cell) => `${cell.ref}=${norm(cell.value)}`),
  }));
}

function summarizeWarnings(items = []) {
  const result = {};
  for (const item of items) result[item.warning || 'unknown'] = (result[item.warning || 'unknown'] || 0) + 1;
  return result;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine2-diagnostic.json')));
const report = JSON.parse(await fs.readFile(path.join(inputDir, 'download-report.json'), 'utf8'));
const result = { version: 2, status: 'diagnostic_only', course: 2, streams: [] };

for (const stream of ['1', '2', '3']) {
  const { classSource, lectureSource } = sourcePair(report, stream);
  const classBuffer = await fs.readFile(path.join(inputDir, classSource.filename));
  const lectureBuffer = await fs.readFile(path.join(inputDir, lectureSource.filename));
  if (sha256(classBuffer) !== classSource.sha256 || sha256(lectureBuffer) !== lectureSource.sha256) throw new Error(`medicine-2 stream ${stream} source SHA mismatch`);
  const [classStructure, lectureStructure] = await Promise.all([readIzhgmuXlsxStructure(classBuffer), readIzhgmuXlsxStructure(lectureBuffer)]);
  const groups = groupCodes(classStructure);
  const streamResult = {
    stream,
    classFile: classSource.filename,
    classSha256: classSource.sha256,
    lectureFile: lectureSource.filename,
    lectureSha256: lectureSource.sha256,
    groups,
    classTopology: topology(classStructure),
    lectureTopology: topology(lectureStructure),
    parserError: null,
    lecture: null,
    groupsDiagnostic: [],
  };

  try {
    for (const groupCode of groups) {
      const weekly = parseIzhgmuWeeklyStructures({ classStructure, companionStructure: lectureStructure, groupCode });
      const lecture = parseIzhgmuLectureStructures({ classStructure, lectureStructure, weeklyParsed: weekly });
      const combined = composeIzhgmuWeeklyLecture({ weeklyParsed: weekly, lectureParsed: lecture });
      streamResult.lecture ||= {
        stats: lecture.stats,
        choiceBlocks: lecture.classCoverage?.choiceRequired || [],
        unmapped: lecture.classCoverage?.unmapped || [],
      };
      const metadata = { academicYear: '2025/2026', semester: 'spring', facultyCode: 'medicine', course: 2, groupCode, stream };
      const source = { classFileName: classSource.filename, classFileHash: classSource.sha256, companionFileName: lectureSource.filename, companionFileHash: lectureSource.sha256 };
      const qaCandidate = buildIzhgmuWeeklyLectureQaCandidate({ parsed: combined, metadata, source });
      let qaSafeEvents = null;
      let qaError = null;
      try { qaSafeEvents = prepareSchedulePublication(qaCandidate, { now: '2026-08-16T00:00:00.000Z' }).batch.events.length; }
      catch (error) { qaError = { code: error.code || null, message: error.message }; }
      streamResult.groupsDiagnostic.push({
        groupCode,
        weeklySeries: weekly.series?.length || 0,
        combinedSeries: combined.series?.length || 0,
        reviewRequired: combined.reviewRequired?.length || 0,
        reviewWarnings: summarizeWarnings(combined.reviewRequired),
        unresolvedChoices: combined.unresolvedChoices?.length || 0,
        deferred: combined.deferred?.length || 0,
        publishable: combined.publishable,
        qaSafeEvents,
        qaError,
      });
    }
  } catch (error) {
    streamResult.parserError = { code: error.code || null, message: error.message };
  }
  result.streams.push(streamResult);
}

result.summary = {
  groupCount: result.streams.reduce((sum, item) => sum + item.groups.length, 0),
  streams: result.streams.length,
  allGroups: result.streams.flatMap((item) => item.groups),
  streamsWithParserError: result.streams.filter((item) => item.parserError).map((item) => item.stream),
};
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log('IZHGMU_MEDICINE2_DIAGNOSTIC', JSON.stringify(result.summary));
for (const item of result.streams) {
  console.log('STREAM', item.stream, 'GROUPS', item.groups.join(','));
  console.log('CLASS_TOPOLOGY', JSON.stringify(item.classTopology));
  console.log('LECTURE_TOPOLOGY', JSON.stringify(item.lectureTopology));
  console.log('PARSER_ERROR', JSON.stringify(item.parserError));
  if (!item.parserError) {
    console.log('LECTURE', JSON.stringify(item.lecture));
    console.log('GROUP_DIAGNOSTICS', JSON.stringify(item.groupsDiagnostic));
  }
}
