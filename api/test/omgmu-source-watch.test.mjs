import assert from "node:assert/strict";
import test from "node:test";
import { extractOmgmuScheduleContext, extractOmgmuSources } from "../src/adapters/omgmu/discover.mjs";
import { buildOmgmuSourceWatchReport } from "../src/adapters/omgmu/watch.mjs";

const config = {
  university: "omgmu",
  expectedAcademicYear: "2026/2027",
  targetPrograms: [
    { program: "medicine", label: "Лечебное дело" },
    { program: "pediatrics", label: "Педиатрия" },
    { program: "dentistry", label: "Стоматология" },
    { program: "preventive-medicine", label: "Медико-профилактическое дело" },
    { program: "pharmacy", label: "Фармация" },
  ],
  knownProgram: { program: "medicine-international", label: "Иностранное лечебное дело" },
};

test("extracts official ОмГМУ semester and academic year", () => {
  const html = `
    <h1>Расписание занятий</h1>
    <p>РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ, ПРОВОДИМЫХ В ФОРМЕ КОНТАКТНОЙ РАБОТЫ,
    НА ОСЕННИЙ СЕМЕСТР 2026/2027 УЧЕБНОГО ГОДА</p>
  `;
  assert.deepEqual(extractOmgmuScheduleContext(html), {
    academicYear: "2026/2027",
    semester: "autumn",
    heading: "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ, ПРОВОДИМЫХ В ФОРМЕ КОНТАКТНОЙ РАБОТЫ, НА ОСЕННИЙ СЕМЕСТР 2026/2027 УЧЕБНОГО ГОДА",
  });
});

test("classifies ordinary faculty PDF links when they become active", () => {
  const html = `
    <a href="/files/2026/1-lech.pdf">1 леч</a>
    <a href="/files/2026/2-ped.pdf">2 пед</a>
    <a href="/files/2026/3-stom.pdf">3 стом</a>
    <a href="/files/2026/4-med.pdf">4 мед циклы</a>
    <a href="/files/2026/5-farm.pdf">5 фарм</a>
  `;
  const sources = extractOmgmuSources(html);
  assert.deepEqual(sources.map((item) => [item.program, item.course]), [
    ["medicine", 1],
    ["pediatrics", 2],
    ["dentistry", 3],
    ["preventive-medicine", 4],
    ["pharmacy", 5],
  ]);
});

test("waits while only international medicine sources are active", () => {
  const report = buildOmgmuSourceWatchReport({
    university: "omgmu",
    discoveredAt: "2026-08-10T00:00:00Z",
    sourcePage: "https://omsk-osma.ru/studentam/raspisanie-zanyatiy",
    scheduleContext: { academicYear: "2025/2026", semester: "spring", heading: "spring" },
    sources: [
      { program: "medicine-international", course: 1, url: "https://example/1.pdf" },
    ],
  }, config);
  assert.equal(report.status, "waiting");
  assert.equal(report.availableTargetCount, 0);
  assert.equal(report.readyFor2026AutumnIngest, false);
});

test("marks target faculty files ready when 2026/2027 page appears", () => {
  const report = buildOmgmuSourceWatchReport({
    university: "omgmu",
    discoveredAt: "2026-08-20T00:00:00Z",
    sourcePage: "https://omsk-osma.ru/studentam/raspisanie-zanyatiy",
    scheduleContext: { academicYear: "2026/2027", semester: "autumn", heading: "autumn" },
    sources: [
      { program: "medicine-international", course: 1, url: "https://example/bilingva.pdf" },
      { program: "pediatrics", course: 1, url: "https://example/ped-1.pdf" },
      { program: "pediatrics", course: 2, url: "https://example/ped-2.pdf" },
    ],
  }, config);
  assert.equal(report.status, "ready-for-ingest");
  assert.equal(report.readyFor2026AutumnIngest, true);
  assert.deepEqual(report.availableTargets, ["pediatrics"]);
  assert.deepEqual(report.targetPrograms.find((item) => item.program === "pediatrics").courses, [1, 2]);
});
