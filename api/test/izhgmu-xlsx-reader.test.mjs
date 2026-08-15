import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseIzhgmuSharedStringsXml,
  parseIzhgmuStylesXml,
  parseIzhgmuWorksheetXml,
} from '../src/adapters/izhgmu/xlsx-reader.mjs';

test('IZH-W06 preserves rich-text underline as source evidence', () => {
  const strings = parseIzhgmuSharedStringsXml(`
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <si>
        <r><rPr><u/></rPr><t>Химия</t></r>
        <r><t xml:space="preserve">   Физика</t></r>
      </si>
    </sst>
  `);
  assert.equal(strings.length, 1);
  assert.equal(strings[0].text, 'Химия   Физика');
  assert.deepEqual(strings[0].runs.map((run) => ({ text: run.text, underline: run.underline })), [
    { text: 'Химия', underline: true },
    { text: '   Физика', underline: false },
  ]);
});

test('IZH-CYCLE reader preserves style ids for blank cells and maps style to fill id', () => {
  const styles = parseIzhgmuStylesXml(`
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <cellXfs count="3"><xf fillId="0"/><xf fillId="4"/><xf fillId="12"/></cellXfs>
    </styleSheet>
  `);
  assert.deepEqual(styles, [
    { styleId: 0, fillId: 0 },
    { styleId: 1, fillId: 4 },
    { styleId: 2, fillId: 12 },
  ]);

  const sheet = parseIzhgmuWorksheetXml(`
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData><row r="10">
        <c r="B10" s="1" t="inlineStr"><is><t>О</t></is></c>
        <c r="C10" s="1"/>
        <c r="D10" s="2" t="inlineStr"><is><t>П</t></is></c>
      </row></sheetData>
    </worksheet>
  `, [], 'cycle');
  assert.deepEqual(sheet.cells.map((cell) => [cell.ref, cell.styleId, cell.value]), [
    ['B10', 1, 'О'], ['D10', 2, 'П'],
  ]);
  assert.deepEqual(sheet.styledCells.map((cell) => [cell.ref, cell.styleId]), [
    ['B10', 1], ['C10', 1], ['D10', 2],
  ]);
});
