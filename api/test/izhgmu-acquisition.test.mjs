import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeIzhgmuUrl,
  classifyIzhgmuLabel,
  extractIzhgmuSources,
} from "../src/adapters/izhgmu/discover.mjs";
import { detectSpreadsheetKind } from "../src/adapters/izhgmu/download.mjs";

test("IzhGMU canonicalizes bare host and relative URLs to www.igma.ru", () => {
  assert.equal(
    canonicalizeIzhgmuUrl("https://igma.ru/images/a.xlsx"),
    "https://www.igma.ru/images/a.xlsx",
  );
  assert.equal(
    canonicalizeIzhgmuUrl("/images/b.xls"),
    "https://www.igma.ru/images/b.xls",
  );
});

test("IzhGMU label classifier preserves metadata and source anomalies", () => {
  const item = classifyIzhgmuLabel("Расписание занятий для студентов 1 курса 2 поток лечебного факультета на весенний семестр 2025-2025 уч.г.");
  assert.equal(item.faculty, "medicine");
  assert.equal(item.course, 1);
  assert.equal(item.stream, "2");
  assert.equal(item.sourceKind, "class");
  assert.equal(item.term, "spring");
  assert.equal(item.academicYear, "2025-2025");
  assert.deepEqual(item.warnings, ["malformed-academic-year"]);
  assert.equal(item.parserRouting, "fingerprint-required");
});

test("IzhGMU discovery accepts XLS and XLSX schedule links and ignores non-schedule files", () => {
  const html = `
    <a href="https://igma.ru/images/a.xlsx">Расписание занятий для студентов 1 курса педиатрического факультета на весенний семестр 2025-2026 уч.г.</a>
    <a href="/images/b.xls">Расписание лекций для студентов 4 курса лечебного факультета на весенний семестр 2025-2026 уч.г.</a>
    <a href="/images/c.pdf">Расписание занятий для студентов 2 курса лечебного факультета</a>
    <a href="/images/d.xlsx">Сроки семестра</a>
  `;
  const sources = extractIzhgmuSources(html);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((item) => item.url), [
    "https://www.igma.ru/images/a.xlsx",
    "https://www.igma.ru/images/b.xls",
  ]);
});

test("IzhGMU detects XLSX ZIP and legacy XLS OLE signatures", () => {
  assert.equal(detectSpreadsheetKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])), "xlsx");
  assert.equal(detectSpreadsheetKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1])), "xls");
  assert.equal(detectSpreadsheetKind(Buffer.from("<html>error</html>")), null);
});
