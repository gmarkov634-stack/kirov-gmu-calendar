import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sequence(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
}

function groupsFromSpan(span) {
  const match = String(span).match(/^(\d+)-(\d+)$/);
  if (!match) return [];
  return sequence(Number(match[1]), Number(match[2]));
}

function countsByKind(items = []) {
  const counts = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] || 0) + 1;
  return counts;
}

function classificationCounts(items = []) {
  const counts = {};
  for (const item of items) counts[item.classification] = (counts[item.classification] || 0) + 1;
  return counts;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const audiencePath = path.join(inputDir, 'medicine3-lecture-audience.json');
const rawAudiencePath = path.join(inputDir, 'medicine3-lecture-audience-raw.json');
const cyclePath = path.join(inputDir, 'medicine3-legacy-cycle.json');
const diagnosticPath = path.join(inputDir, 'medicine3-lecture-diagnostic.json');

const audience = JSON.parse(await fs.readFile(audiencePath, 'utf8'));
const cycles = JSON.parse(await fs.readFile(cyclePath, 'utf8'));
const diagnostic = JSON.parse(await fs.readFile(diagnosticPath, 'utf8'));

const EXPECTED_SOURCE = {
  filename: '18_medicine_course-3_lecture_ru.xlsx',
  sha256: 'a8cba5f873a6461fd91a4ee71985d31ad05a4abefc6c1d922401f9e4234cd145',
  sheet: 'Лекции все',
};
const EXPECTED = {
  kind: 'lecture_date_weekday_mismatch',
  row: 17,
  ref: 'L17',
  sourceDate: '2026-03-30',
  correctedDate: '2026-03-31',
  sourceWeekday: 'вторник',
  disciplineRaw: 'Патофизиология',
  discipline: 'Патофизиология',
  time: '8.30-10.05',
  location: '8 ауд',
  adjacentEvidenceRef: 'L16',
  adjacentEvidenceValue: '31',
  russianPairs: ['321-322', '323-324', '325-326'],
  russianGroups: sequence(321, 326),
};

for (const [key, value] of Object.entries(EXPECTED_SOURCE)) {
  if (audience.source?.[key] !== value) {
    throw new Error(`IZH-C3-17 source contract changed: ${key}=${JSON.stringify(audience.source?.[key])}`);
  }
}
if (audience.verifierVersion !== 'izhgmu-medicine3-lecture-audience-v1') {
  throw new Error(`IZH-C3-17 verifier contract changed: ${audience.verifierVersion}`);
}
if (cycles.parserVersion !== 'izhgmu-medicine3-legacy-cycle-v2') {
  throw new Error(`IZH-C3-17 cycle parser contract changed: ${cycles.parserVersion}`);
}

const targetIndexes = [];
for (let index = 0; index < (audience.unresolved || []).length; index += 1) {
  const item = audience.unresolved[index];
  if (item.kind === EXPECTED.kind && item.ref === EXPECTED.ref && item.date === EXPECTED.sourceDate) {
    targetIndexes.push(index);
  }
}
if (targetIndexes.length !== 1) {
  throw new Error(`IZH-C3-17 expected exactly one ${EXPECTED.ref}/${EXPECTED.sourceDate} mismatch, got ${targetIndexes.length}`);
}
const targetIndex = targetIndexes[0];
const target = audience.unresolved[targetIndex];
for (const [key, value] of Object.entries({
  kind: EXPECTED.kind,
  row: EXPECTED.row,
  ref: EXPECTED.ref,
  date: EXPECTED.sourceDate,
  sourceWeekday: EXPECTED.sourceWeekday,
  disciplineRaw: EXPECTED.disciplineRaw,
})) {
  if (target[key] !== value) {
    throw new Error(`IZH-C3-17 mismatch contract changed: ${key}=${JSON.stringify(target[key])}`);
  }
}

const rowAudit = (audience.rowAudits || []).find((item) => Number(item.row) === EXPECTED.row);
if (!rowAudit) throw new Error('IZH-C3-17 row 17 audit missing');
for (const [key, value] of Object.entries({
  day: EXPECTED.sourceWeekday,
  disciplineRaw: EXPECTED.disciplineRaw,
  discipline: EXPECTED.discipline,
  time: EXPECTED.time,
  location: EXPECTED.location,
})) {
  if (rowAudit[key] !== value) {
    throw new Error(`IZH-C3-17 row audit contract changed: ${key}=${JSON.stringify(rowAudit[key])}`);
  }
}

const sheet = (diagnostic.sheets || []).find((item) => item.name === EXPECTED_SOURCE.sheet);
if (!sheet) throw new Error('IZH-C3-17 lecture diagnostic sheet missing');
const sourceRow = (sheet.rowSummaries || []).find((item) => Number(item.row) === EXPECTED.row);
const targetCell = sourceRow?.dates?.find((cell) => cell.ref === EXPECTED.ref);
if (!targetCell || String(targetCell.value) !== '30') {
  throw new Error(`IZH-C3-17 ${EXPECTED.ref} source value changed`);
}
const adjacentRow = (sheet.rowSummaries || []).find((item) => Number(item.row) === 16);
const adjacentCell = adjacentRow?.dates?.find((cell) => cell.ref === EXPECTED.adjacentEvidenceRef);
if (!adjacentCell || String(adjacentCell.value) !== EXPECTED.adjacentEvidenceValue) {
  throw new Error(`IZH-C3-17 adjacent same-column evidence ${EXPECTED.adjacentEvidenceRef} changed`);
}

const russianPairs = [];
for (const pair of cycles.groupPairs || []) {
  if ((pair.series || []).some((series) => (
    series.discipline === EXPECTED.discipline && (series.dates || []).includes(EXPECTED.correctedDate)
  ))) {
    russianPairs.push(String(pair.groupSpan));
  }
}
russianPairs.sort();
if (JSON.stringify(russianPairs) !== JSON.stringify(EXPECTED.russianPairs)) {
  throw new Error(`IZH-C3-17 corrected-date cycle audience changed: ${JSON.stringify(russianPairs)}`);
}
const russianGroups = [...new Set(russianPairs.flatMap(groupsFromSpan))].sort();
if (JSON.stringify(russianGroups) !== JSON.stringify(EXPECTED.russianGroups)) {
  throw new Error(`IZH-C3-17 corrected-date group audience changed: ${JSON.stringify(russianGroups)}`);
}

const conflicting = (audience.ordinary || []).filter((item) => (
  item.date === EXPECTED.correctedDate
  && item.discipline === EXPECTED.discipline
  && (item.russianGroups || []).some((group) => russianGroups.includes(String(group)))
));
if (conflicting.length !== 0) {
  throw new Error(`IZH-C3-17 corrected lecture would duplicate ${conflicting.length} existing ordinary lecture(s)`);
}

await fs.copyFile(audiencePath, rawAudiencePath);

const correction = {
  ruleId: 'IZH-C3-17',
  disposition: 'source_day_value_corrected_by_weekday_column_cycle_consensus',
  reason: 'L17 contains 30 under the Tuesday block, while 31.03.2026 is Tuesday; L16 in the same March column contains 31, and the exact Pathophysiology cycle for groups 321-326 includes 31.03.2026.',
  sourceDate: EXPECTED.sourceDate,
  correctedDate: EXPECTED.correctedDate,
  sourceWeekday: EXPECTED.sourceWeekday,
  adjacentEvidenceRef: EXPECTED.adjacentEvidenceRef,
};
const item = {
  kind: 'ordinary_lecture',
  row: EXPECTED.row,
  ref: EXPECTED.ref,
  date: EXPECTED.correctedDate,
  discipline: EXPECTED.discipline,
  disciplineRaw: EXPECTED.disciplineRaw,
  time: EXPECTED.time,
  location: EXPECTED.location,
  fillId: targetCell.fillId ?? null,
  styleId: targetCell.styleId ?? null,
  classification: 'russian_only',
  russianPairs,
  englishPairs: [],
  russianGroups,
  englishGroups: [],
  sourceCorrection: correction,
};

audience.ordinary = [...(audience.ordinary || []), item].sort((left, right) => (
  left.date.localeCompare(right.date) || Number(left.row) - Number(right.row) || String(left.ref).localeCompare(String(right.ref))
));
audience.unresolved = (audience.unresolved || []).filter((_, index) => index !== targetIndex);
audience.nonBlockingDiagnostics = [
  ...(audience.nonBlockingDiagnostics || []),
  { ...target, blocking: false, ...correction },
];
for (const group of russianGroups) {
  if (!Array.isArray(audience.perRussianGroup?.[group])) {
    throw new Error(`IZH-C3-17 perRussianGroup missing ${group}`);
  }
  audience.perRussianGroup[group].push(item);
  audience.perRussianGroup[group].sort((left, right) => (
    left.date.localeCompare(right.date) || String(left.time).localeCompare(String(right.time)) || String(left.ref).localeCompare(String(right.ref))
  ));
}

audience.stats = {
  ...(audience.stats || {}),
  ordinaryDateCells: audience.ordinary.length,
  classifications: classificationCounts(audience.ordinary),
  unresolvedKinds: countsByKind(audience.unresolved),
  perRussianGroupCounts: Object.fromEntries(
    Object.entries(audience.perRussianGroup || {}).map(([group, events]) => [group, events.length]),
  ),
  nonBlockingDiagnostics: countsByKind(audience.nonBlockingDiagnostics),
};
audience.weekdayResolution = {
  version: 'izhgmu-medicine3-weekday-resolution-v1',
  appliedRules: ['IZH-C3-17'],
  correctedCount: 1,
  correctedReferences: [EXPECTED.ref],
  failClosedOnSourceChange: true,
};

await fs.writeFile(audiencePath, `${JSON.stringify(audience, null, 2)}\n`, 'utf8');
console.log('IZHGMU_MEDICINE3_WEEKDAY_RESOLUTION', JSON.stringify({
  ruleId: 'IZH-C3-17',
  corrected: {
    ref: EXPECTED.ref,
    from: EXPECTED.sourceDate,
    to: EXPECTED.correctedDate,
    discipline: EXPECTED.discipline,
    russianGroups,
  },
  remainingUnresolvedKinds: audience.stats.unresolvedKinds,
  perRussianGroupCounts: Object.fromEntries(russianGroups.map((group) => [group, audience.stats.perRussianGroupCounts[group]])),
}));
