import assert from "node:assert/strict";
import test from "node:test";
import { extractOmgmuScheduleContext, extractOmgmuSources, validateOmgmuManifest } from "../src/adapters/omgmu/discover.mjs";
import { buildOmgmuSourceWatchReport } from "../src/adapters/omgmu/watch.mjs";

const config = {
  university: "omgmu",
  expectedAcademicYear: "2026/2027",
  expectedSemester: "autumn",
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

test("classifies generic master links from explicit section/course context", () => {
  const html = `
    <h2>ОБЩЕСТВЕННОЕ ЗДРАВООХРАНЕНИЕ</h2>
    <div>1 год обучения
      <a href="/files/r/UU/magistr/2026/ozz/lecz_magistr_2026-2027_1.pdf">Лекции</a>
      <a href="/files/r/UU/magistr/2026/ozz/magistr_praktzan_2026-2027_1.pdf">Практические занятия</a>
    </div>
    <div>2 год обучения
      <a href="/files/r/UU/magistr/2026/ozz/lecz_magistr_2026-2027_2.pdf">Лекции</a>
      <a href="/files/r/UU/magistr/2026/ozz/magistr_praktzan_2026-2027_2.pdf">Практические занятия</a>
    </div>
    <h2>ПСИХОЛОГИЯ</h2>
    <div>1 год обучения
      <a href="/files/r/UU/magistr/2026/psih/lecz_magistr_2026-2027_1.pdf">Лекции</a>
      <a href="/files/r/UU/magistr/2026/psih/magistr_praktzan_2026-2027_1.pdf">Практические занятия</a>
    </div>
    <div>2 год обучения
      <a href="/files/r/UU/magistr/2026/psih/lecz_magistr_2026-2027_2.pdf">Лекции</a>
      <a href="/files/r/UU/magistr/2026/psih/magistr_praktzan_2026-2027_2.pdf">Практические занятия</a>
    </div>
  `;
  const sources = extractOmgmuSources(html);
  assert.deepEqual(sources.map((item) => [item.program, item.course, item.part]), [
    ["public-health", 1, "lectures"],
    ["public-health", 1, "practice"],
    ["public-health", 2, "lectures"],
    ["public-health", 2, "practice"],
    ["psychology", 1, "lectures"],
    ["psychology", 1, "practice"],
    ["psychology", 2, "lectures"],
    ["psychology", 2, "practice"],
  ]);
  assert.deepEqual(validateOmgmuManifest({ sources }), []);
});

test("generic target links inherit only recognized faculty/course context", () => {
  const html = `
    <h2>ПЕДИАТРИЧЕСКИЙ ФАКУЛЬТЕТ</h2>
    <div>2 пед
      <a href="/files/r/UU/2026/ped2-lectures.pdf">Лекции</a>
      <a href="/files/r/UU/2026/ped2-practice.pdf">Практические занятия</a>
    </div>
  `;
  const sources = extractOmgmuSources(html);
  assert.deepEqual(sources.map((item) => [item.program, item.course, item.part]), [
    ["pediatrics", 2, "lectures"],
    ["pediatrics", 2, "practice"],
  ]);
});

test("unknown generic schedule context remains fail-closed", () => {
  const html = `
    <h2>НЕИЗВЕСТНАЯ ПРОГРАММА</h2>
    <div>1 год обучения <a href="/files/r/UU/other/generic.pdf">Лекции</a></div>
  `;
  const sources = extractOmgmuSources(html);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].program, null);
  assert.deepEqual(validateOmgmuManifest({ sources }), ["unclassified program: Лекции"]);
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

test("out-of-scope master sources do not activate the target offer", () => {
  const report = buildOmgmuSourceWatchReport({
    university: "omgmu",
    discoveredAt: "2026-08-17T00:00:00Z",
    sourcePage: "https://omsk-osma.ru/studentam/raspisanie-zanyatiy",
    scheduleContext: { academicYear: null, semester: null, heading: "current page" },
    sources: [
      { program: "medicine-international", course: 1, url: "https://example/bilingva.pdf" },
      { program: "public-health", course: 1, url: "https://example/ozz.pdf" },
      { program: "psychology", course: 1, url: "https://example/psychology.pdf" },
    ],
  }, config);
  assert.equal(report.status, "waiting");
  assert.equal(report.availableTargetCount, 0);
  assert.equal(report.readyFor2026AutumnIngest, false);
});

test("does not accept spring 2026/2027 target files as autumn ingest", () => {
  const report = buildOmgmuSourceWatchReport({
    university: "omgmu",
    discoveredAt: "2027-01-10T00:00:00Z",
    sourcePage: "https://omsk-osma.ru/studentam/raspisanie-zanyatiy",
    scheduleContext: { academicYear: "2026/2027", semester: "spring", heading: "spring" },
    sources: [
      { program: "pediatrics", course: 1, url: "https://example/ped-1.pdf" },
    ],
  }, config);
  assert.equal(report.academicYearMatches, true);
  assert.equal(report.semesterMatches, false);
  assert.equal(report.periodMatches, false);
  assert.equal(report.status, "needs-period-review");
  assert.equal(report.readyFor2026AutumnIngest, false);
});

test("marks target faculty files ready when 2026/2027 autumn page appears", () => {
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
  assert.equal(report.expectedSemester, "autumn");
  assert.equal(report.semesterMatches, true);
  assert.equal(report.readyFor2026AutumnIngest, true);
  assert.deepEqual(report.availableTargets, ["pediatrics"]);
  assert.deepEqual(report.targetPrograms.find((item) => item.program === "pediatrics").courses, [1, 2]);
});
