import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyIzhgmuLabel,
  discoverIzhgmuSources,
  extractIzhgmuScheduleContext,
  extractIzhgmuSources,
} from "../src/adapters/izhgmu/discover.mjs";

const PAGE = `
  <h3>Уважаемые студенты!</h3><h3>Обращаем Ваше внимание на ежедневные изменения расписания!</h3>
  <h2>Лечебный факультет - Весна 2025-2026</h2>
  <a href="/files/1-class.xlsx">Расписание занятий для студентов 1 курса 2 поток лечебного факультета на весенний семестр 2025-2025 уч.г.</a>
  <a href="/files/1-lecture.xlsx">Расписание лекций для студентов 1 курса 2 поток лечебного факультета на весенний семестр 2025-2026 уч.г.</a>
  <a href="/files/en-lecture.xlsx">Расписание лекций для англоязычных студентов 2 курса лечебного факультета на осенний семестр 2025-2026 уч.г.</a>
  <a href="/files/ped.xlsx">Расписание занятий для студентов 6 курса педиатрического факультета на весенний семестр 2025-2026 уч.г.</a>
  <a href="/files/stom.xlsx">Расписание лекций для студентов 5 курса стоматологического факультета на весенний семестр 2025-2026 уч.г.</a>
  <a href="/files/notes.pdf">Расписание занятий 1 курса лечебного факультета</a>
  <a href="/news.xlsx">Новости</a>
`;

test("classifies IzhGMU faculty, course, stream, kind and language", () => {
  assert.deepEqual(
    classifyIzhgmuLabel("Расписание лекций для студентов 4 курса 2 поток лечебного факультета на весенний семестр 2025-2026 уч.г."),
    {
      faculty: "medicine",
      course: 4,
      stream: "2",
      sourceKind: "lecture",
      language: "ru",
      academicYear: "2025-2026",
      term: "spring",
      parserProfile: null,
      parserRouting: "fingerprint-required",
      warnings: [],
    },
  );
  assert.equal(classifyIzhgmuLabel("Расписание занятий для англоязычных студентов 2 курса лечебного факультета").language, "en");
});

test("extracts only schedule XLSX links and leaves parser profile unresolved", () => {
  const sources = extractIzhgmuSources(PAGE);
  assert.equal(sources.length, 5);
  assert.equal(sources[0].faculty, "medicine");
  assert.equal(sources[0].stream, "2");
  assert.equal(sources[0].sourceKind, "class");
  assert.equal(sources[0].parserProfile, null);
  assert.equal(sources[0].parserRouting, "fingerprint-required");
});

test("extracts page schedule context", () => {
  assert.deepEqual(extractIzhgmuScheduleContext(PAGE), {
    academicYear: "2025-2026",
    term: "spring",
    dailyChangesNotice: true,
  });
});

test("discovery validates structural metadata but surfaces source-label anomalies as warnings", async () => {
  const manifest = await discoverIzhgmuSources({
    fetchFn: async () => new Response(PAGE, { status: 200 }),
  });
  assert.equal(manifest.university, "izhgmu");
  assert.equal(manifest.sourceCount, 5);
  assert.equal(manifest.validation.status, "ok");
  assert.equal(manifest.validation.errors.length, 0);
  assert.equal(manifest.validation.warnings.some((item) => item.includes("malformed-academic-year")), true);
  assert.equal(manifest.validation.warnings.some((item) => item.includes("term differs from page context")), true);
});
