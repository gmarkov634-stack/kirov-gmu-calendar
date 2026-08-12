import test from "node:test";
import assert from "node:assert/strict";
import { parseStylesXml, parseWorksheetXml } from "../src/adapters/kgmu/xlsx-reader.mjs";

test("XLSX reader does not shift values across self-closing cells", () => {
  const strings = ["ПН", "ВТ", "Занятие"];
  const xml = `
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1"/>
          <c r="C1" t="s"><v>2</v></c>
        </row>
        <row r="2">
          <c r="A2" t="s"><v>1</v></c>
        </row>
      </sheetData>
      <mergeCells count="1"><mergeCell ref="C1:D1"/></mergeCells>
    </worksheet>`;
  const sheet = parseWorksheetXml(xml, strings, "test");
  assert.deepEqual(sheet.cells.map((cell) => [cell.ref, cell.value]), [
    ["A1", "ПН"],
    ["C1", "Занятие"],
    ["A2", "ВТ"],
  ]);
  assert.equal(sheet.merges[0].ref, "C1:D1");
  assert.deepEqual(sheet.styledCells, []);
});

test("XLSX reader preserves styled empty cells separately from legacy cells", () => {
  const stylesXml = `
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fills count="3"><fill/><fill/><fill/></fills>
      <cellXfs count="2"><xf numFmtId="0" fillId="0"/><xf numFmtId="0" fillId="2" applyFill="1"/></cellXfs>
    </styleSheet>`;
  const styles = parseStylesXml(stylesXml);
  assert.equal(styles[1].fillId, 2);
  const xml = `
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData><row r="1">
        <c r="A1" s="1" t="inlineStr"><is><t>Neurology</t></is></c>
        <c r="B1" s="1"/>
        <c r="C1"/>
      </row></sheetData>
    </worksheet>`;
  const sheet = parseWorksheetXml(xml, [], "test", styles);
  assert.deepEqual(sheet.cells.map((cell) => [cell.ref, cell.value]), [["A1", "Neurology"]]);
  assert.deepEqual(sheet.styledCells.map((cell) => [cell.ref, cell.value, cell.styleId, cell.fillId]), [
    ["A1", "Neurology", 1, 2],
    ["B1", "", 1, 2],
  ]);
});
