import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyIzhgmuSource,
  discoverIzhgmuSources,
  extractIzhgmuSources,
  sourceFormatFromUrl,
} from "../src/adapters/izhgmu/discover.mjs";

const page = "https://example.test/schedule";

function scheduleLabel({ role = "занятий", course = 1, stream = null, faculty = "лечебного", semester = "весенний", year = "2025-2026", english = false } = {}) {
  return `Расписание ${role} для ${english ? "англоязычных " : ""}студентов ${course} курса${stream ? ` ${stream} поток` : ""} ${faculty} факультета на ${semester} семестр ${year} уч.г.`;
}

test("classifies Ижевский ГМУ source metadata without course-based parser routing", () => {
  const source = classifyIzhgmuSource({
    label: scheduleLabel({ role: "лекций", course: 4, stream: 2 }),
    url: "https://example.test/files/Лекции_4курс_2поток_Весна_25-26.xlsx",
  });
  assert.equal(source.program, "medicine");
  assert.equal(source.language, "ru");
  assert.equal(source.course, 4);
  assert.equal(source.stream, "2");
  assert.equal(source.sourceRole, "lectures");
  assert.equal(source.sourceFormat, "xlsx");
  assert.deepEqual(source.periodConflicts, []);
  assert.equal(Object.hasOwn(source, "parserProfile"), false);
});

test("keeps English medicine as a separate program", () => {
  const source = classifyIzhgmuSource({
    label: scheduleLabel({ role: "занятий", course: 2, english: true }),
    url: "https://example.test/files/англ_леч_2курс_Весна_25-26.xlsx",
  });
  assert.equal(source.program, "medicine_english");
  assert.equal(source.language, "en");
});

test("recognizes both xlsx and legacy xls containers by source URL", () => {
  assert.equal(sourceFormatFromUrl("https://example.test/a.xlsx"), "xlsx");
  assert.equal(sourceFormatFromUrl("https://example.test/a.xls"), "xls");
  assert.equal(sourceFormatFromUrl("https://example.test/a.pdf"), null);
});

test("extracts schedule and auxiliary sources separately and dynamically", () => {
  const html = `
    <a href="/semester.pdf">Сроки весеннего семестра 2025-2026 уч.г.</a>
    <a href="/weeks.xls">Учебные недели весеннего семестра 2025-2026 уч.г.</a>
    <a href="/files/леч_1_Весна_25-26.xlsx">${scheduleLabel({ course: 1 })}</a>
    <a href="/files/леч_3_Весна_25-26.xls">${scheduleLabel({ course: 3 })}</a>
    <a href="/files/ped_6_Весна_25-26.xlsx">${scheduleLabel({ course: 6, faculty: "педиатрического" })}</a>
    <a href="/files/stom_5_Весна_25-26.xlsx">${scheduleLabel({ course: 5, faculty: "стоматологического" })}</a>
  `;
  const { sources, auxiliarySources } = extractIzhgmuSources(html, page);
  assert.equal(sources.length, 4);
  assert.equal(auxiliarySources.length, 2);
  assert.equal(sources[0].sourceFormat, "xlsx");
  assert.equal(sources[1].sourceFormat, "xls");
  assert.equal(sources[2].program, "pediatrics");
  assert.equal(sources[3].program, "dentistry");
  assert.deepEqual(auxiliarySources.map((item) => item.auxiliaryRole), ["semester_dates", "teaching_weeks"]);
});

test("material period conflict is fail-closed", async () => {
  const label = scheduleLabel({ role: "лекций", course: 2, english: true, semester: "осенний" });
  const html = `<a href="/files/англ_леч_2курс_Весна_25-26.xlsx">${label}</a>`;
  const manifest = await discoverIzhgmuSources({
    sourceUrl: page,
    fetchFn: async () => new Response(html, { status: 200 }),
  });
  assert.equal(manifest.sourceCount, 1);
  assert.equal(manifest.validation.status, "needs_source_review");
  assert.match(manifest.validation.errors.join("\n"), /period metadata conflict.*semester conflict/);
});

test("academic-year typo against filename is fail-closed", async () => {
  const label = scheduleLabel({ course: 1, stream: 2, year: "2025-2025" });
  const html = `<a href="/files/леч_1_2поток_Весна_25-26.xlsx">${label}</a>`;
  const manifest = await discoverIzhgmuSources({
    sourceUrl: page,
    fetchFn: async () => new Response(html, { status: 200 }),
  });
  assert.equal(manifest.validation.status, "needs_source_review");
  assert.match(manifest.validation.errors.join("\n"), /academic-year conflict/);
});

test("valid discovery does not depend on a hard-coded source count", async () => {
  const html = `<a href="/files/ped_4_Весна_25-26.xlsx">${scheduleLabel({ course: 4, faculty: "педиатрического" })}</a>`;
  const manifest = await discoverIzhgmuSources({
    sourceUrl: page,
    fetchFn: async () => new Response(html, { status: 200 }),
  });
  assert.equal(manifest.university, "izhgmu");
  assert.equal(manifest.sourceCount, 1);
  assert.equal(manifest.validation.status, "ok");
});
