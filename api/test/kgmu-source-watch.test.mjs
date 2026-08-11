import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyKgmuScheduleLabel,
  discoverKgmuSources,
  extractKgmuSources,
  normalizeKgmuAcademicYear,
} from "../src/adapters/kgmu/discover.mjs";
import { buildKgmuSourceWatchReport } from "../src/adapters/kgmu/watch.mjs";
import { selectKgmuTargetSources } from "../src/adapters/kgmu/download.mjs";

const pediatricsPage = {
  program: "pediatrics",
  label: "Педиатрия",
  url: "https://kirovgma.ru/raspisanie-pediatricheskiy-fakultet",
};

test("KGMU academic year normalization accepts official label formats", () => {
  assert.equal(normalizeKgmuAcademicYear("2025-2026 уч. г."), "2025/2026");
  assert.equal(normalizeKgmuAcademicYear("2026/27"), "2026/2027");
  assert.equal(normalizeKgmuAcademicYear("2026 / 2027"), "2026/2027");
  assert.equal(normalizeKgmuAcademicYear("2026-2028"), null);
});

test("KGMU label classification extracts groups, course and semester", () => {
  assert.deepEqual(
    classifyKgmuScheduleLabel("131-139 (второе полугодие 2025-2026 уч. г.)", "pediatrics"),
    {
      program: "pediatrics",
      course: 1,
      groupStart: "131",
      groupEnd: "139",
      groups: ["131", "132", "133", "134", "135", "136", "137", "138", "139"],
      academicYear: "2025/2026",
      semester: 2,
    },
  );

  const autumn = classifyKgmuScheduleLabel(
    "101-110 (первое полугодие 2026-2027 уч. г.)",
    "medicine",
  );
  assert.equal(autumn.course, 1);
  assert.equal(autumn.semester, 1);
  assert.equal(autumn.academicYear, "2026/2027");
  assert.equal(autumn.groups.length, 10);
});

test("KGMU source extraction keeps only XLSX schedule links", () => {
  const html = `
    <a href="/sites/default/files/files/2026/01/14/123/1_ped.xlsx">131-139 (второе полугодие 2025-2026 уч. г.)</a>
    <a href="/sites/default/files/files/2026/08/20/999/1_ped_autumn.xlsx">131-140 (первое полугодие 2026-2027 уч. г.)</a>
    <a href="/document.pdf">Приказ</a>
  `;
  const sources = extractKgmuSources(html, pediatricsPage);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].url, "https://kirovgma.ru/sites/default/files/files/2026/01/14/123/1_ped.xlsx");
  assert.equal(sources[1].academicYear, "2026/2027");
  assert.equal(sources[1].semester, 1);
  assert.equal(sources[1].groups.at(-1), "140");
});

test("KGMU watch ignores old semester and becomes ready for 2026/27 autumn", () => {
  const manifest = {
    version: 1,
    university: "kgmu",
    discoveredAt: "2026-08-11T00:00:00.000Z",
    validation: { status: "ok", errors: [] },
    sources: [
      {
        program: "pediatrics",
        course: 1,
        groupStart: "131",
        groupEnd: "139",
        groups: ["131", "132", "133", "134", "135", "136", "137", "138", "139"],
        academicYear: "2025/2026",
        semester: 2,
        label: "131-139 old",
        url: "https://example.test/old.xlsx",
      },
      {
        program: "medicine",
        course: 1,
        groupStart: "101",
        groupEnd: "110",
        groups: ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"],
        academicYear: "2026/2027",
        semester: 1,
        label: "101-110 new",
        url: "https://example.test/new.xlsx",
      },
    ],
  };
  const config = {
    university: "kgmu",
    expectedAcademicYear: "2026/27",
    expectedSemester: 1,
    targetPrograms: [
      { program: "medicine", label: "Лечебное дело" },
      { program: "pediatrics", label: "Педиатрия" },
      { program: "dentistry", label: "Стоматология" },
    ],
  };

  const report = buildKgmuSourceWatchReport(manifest, config);
  assert.equal(report.status, "ready-for-ingest");
  assert.equal(report.targetSourceCount, 1);
  assert.equal(report.targetGroupCount, 10);
  assert.deepEqual(report.availableTargets, ["medicine"]);
  assert.equal(report.targetPrograms.find((item) => item.program === "pediatrics").available, false);

  const selected = selectKgmuTargetSources(manifest, { academicYear: "2026/2027", semester: 1 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].program, "medicine");
});

test("KGMU discovery collects configured faculty pages and reports fetch failures", async () => {
  const pages = [
    pediatricsPage,
    { program: "medicine", label: "Лечебное дело", url: "https://example.test/medicine" },
  ];
  const fetchFn = async (url) => {
    if (url.includes("medicine")) return { ok: false, status: 503, text: async () => "" };
    return {
      ok: true,
      status: 200,
      text: async () => '<a href="/files/1.xlsx">131-139 (второе полугодие 2025-2026 уч. г.)</a>',
    };
  };
  const manifest = await discoverKgmuSources({ pages, fetchFn });
  assert.equal(manifest.sourceCount, 1);
  assert.equal(manifest.pages[0].status, "ok");
  assert.equal(manifest.pages[1].status, "failed");
  assert.equal(manifest.validation.status, "needs-review");
  assert.match(manifest.validation.errors.at(-1), /page request failed: medicine/);
});
