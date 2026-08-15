import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIzhgmuSharedStringsXml } from '../src/adapters/izhgmu/xlsx-reader.mjs';

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
