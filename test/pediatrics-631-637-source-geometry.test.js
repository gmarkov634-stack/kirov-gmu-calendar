import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

const [probe, decisions] = await Promise.all([
  readJson('qa/2026-2027-semester-1/pediatrics-631-637.source-probe.json'),
  readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.decisions.json')
]);

const sheet = probe.source.sheets[0];
const cellValues = new Map(sheet.nonEmptyCells.map(({ coord, value }) => [coord, value]));

function columnNumber(name) {
  let value = 0;
  for (const char of name) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}

function columnName(value) {
  let result = '';
  let current = value;
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function parseCoord(coord) {
  const match = /^([A-Z]+)(\d+)$/.exec(coord);
  assert.ok(match, `invalid coordinate ${coord}`);
  return { column: columnNumber(match[1]), row: Number(match[2]) };
}

function parseRange(range) {
  const [start, end] = range.split(':');
  return { start: parseCoord(start), end: parseCoord(end), startCoord: start };
}

function decodeMask(table, maskHex) {
  const mask = BigInt(`0x${maskHex}`);
  return table.filter((_, index) => (mask & (1n << BigInt(index))) !== 0n);
}

const mergedByStart = new Map(sheet.mergedRanges.map((range) => {
  const parsed = parseRange(range);
  return [parsed.startCoord, { ...parsed, range }];
}));

const monthMeta = new Map([
  ['Сентябрь', { year: 2026, month: 9 }],
  ['Октябрь', { year: 2026, month: 10 }],
  ['Ноябрь', { year: 2026, month: 11 }],
  ['Декабрь', { year: 2026, month: 12 }],
  ['Январь', { year: 2027, month: 1 }]
]);

const monthSpans = [];
for (const [coord, value] of cellValues) {
  const parsed = parseCoord(coord);
  const meta = monthMeta.get(value);
  const merged = mergedByStart.get(coord);
  if (parsed.row === 13 && meta && merged) monthSpans.push({ ...meta, ...merged });
}

const dateByColumn = new Map();
for (let column = columnNumber('C'); column <= columnNumber('DK'); column += 1) {
  const day = cellValues.get(`${columnName(column)}14`);
  if (day == null || day === '') continue;
  const month = monthSpans.find((span) => span.start.column <= column && column <= span.end.column);
  assert.ok(month, `missing month for column ${columnName(column)}`);
  const iso = `${month.year}-${String(month.month).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
  dateByColumn.set(column, iso);
}

const sourceBlocks = [];
for (let row = 16; row <= 22; row += 1) {
  for (const [coord, value] of cellValues) {
    const parsed = parseCoord(coord);
    const merged = mergedByStart.get(coord);
    if (parsed.row !== row || !merged) continue;
    if (merged.start.row !== merged.end.row) continue;
    if (merged.start.column < columnNumber('C') || merged.start.column >= columnNumber('CX')) continue;
    sourceBlocks.push({ coord, value, row, ...merged });
  }
}
sourceBlocks.sort((left, right) => left.row - right.row || left.start.column - right.start.column);

const decisionsBySource = new Map();
for (const tuple of decisions.decisions) {
  const base = tuple[0].split('#')[0];
  if (!decisionsBySource.has(base)) decisionsBySource.set(base, []);
  decisionsBySource.get(base).push(tuple);
}

test('all Pediatrics 631-637 decision date masks exactly follow source merged-range geometry', () => {
  assert.equal(sourceBlocks.length, 77);
  assert.equal(decisions.logicalSourceCellCount, 77);
  assert.equal(decisions.decisionCount, 86);
  assert.equal(decisions.decisions.length, 86);
  assert.equal(decisionsBySource.size, 77);

  let timedOccurrences = 0;
  let dateOnlyOccurrences = 0;
  let starredBlocks = 0;

  for (const block of sourceBlocks) {
    const tuples = decisionsBySource.get(block.coord);
    assert.ok(tuples, `missing decision for ${block.coord}`);

    const sourceDates = [];
    for (let column = block.start.column; column <= block.end.column; column += 1) {
      const date = dateByColumn.get(column);
      if (date) sourceDates.push(date);
    }

    const sourceGroup = cellValues.get(`B${block.row}`);
    const decodedDates = [];
    for (const tuple of tuples) {
      const [, groupMaskHex, dateMaskHex] = tuple;
      assert.deepEqual(decodeMask(decisions.groupTable, groupMaskHex), [sourceGroup], `${block.coord} group mask`);
      decodedDates.push(...decodeMask(decisions.dateTable, dateMaskHex));
    }
    assert.deepEqual(decodedDates.toSorted(), sourceDates.toSorted(), `${block.coord} date mask`);

    const sourceLabel = String(block.value).replace(/\s+/g, ' ').trim();
    if (sourceLabel.endsWith('*')) {
      starredBlocks += 1;
      assert.equal(tuples.length, 2, `${block.coord} C02 tuple count`);
      const first = tuples.find((tuple) => tuple[0].endsWith('#c02-first'));
      const rest = tuples.find((tuple) => tuple[0].endsWith('#c02-rest'));
      assert.ok(first, `${block.coord} missing C02 first`);
      assert.ok(rest, `${block.coord} missing C02 rest`);
      assert.deepEqual(decodeMask(decisions.dateTable, first[2]), [sourceDates[0]], `${block.coord} C02 first date`);
      assert.deepEqual(decodeMask(decisions.dateTable, rest[2]), sourceDates.slice(1), `${block.coord} C02 rest dates`);
    } else {
      assert.equal(tuples.length, 1, `${block.coord} ordinary tuple count`);
    }

    if (sourceLabel.startsWith('Электив')) dateOnlyOccurrences += sourceDates.length;
    else timedOccurrences += sourceDates.length;
  }

  assert.equal(starredBlocks, 9);
  assert.equal(timedOccurrences, 637);
  assert.equal(dateOnlyOccurrences, 42);
  assert.equal(timedOccurrences + dateOnlyOccurrences, 679);
});
