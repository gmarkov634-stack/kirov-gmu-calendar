import assert from "node:assert/strict";
import test from "node:test";
import {
  IZHGMU_LAUNCH_TARGET,
  selectIzhgmuLaunchTargetSources,
  summarizeIzhgmuLaunchTarget,
} from "../src/adapters/izhgmu/target-watch.mjs";

function source(overrides = {}) {
  return {
    label: "Расписание занятий 1 курс лечебный факультет осень 2026-2027",
    url: "https://www.igma.ru/images/medicine-1.xlsx",
    faculty: "medicine",
    course: 1,
    stream: "1",
    sourceKind: "class",
    language: "ru",
    academicYear: "2026-2027",
    term: "autumn",
    warnings: [],
    ...overrides,
  };
}

function manifest(sources) {
  return {
    version: 1,
    university: "izhgmu",
    sourcePage: "https://www.igma.ru/schedule",
    scheduleContext: { academicYear: "2026-2027", term: "autumn" },
    sources,
    validation: { status: "ok", errors: [], warnings: [] },
  };
}

test("target watch selects only exact medicine 1-3 autumn 2026-2027 sources", () => {
  const selected = selectIzhgmuLaunchTargetSources([
    source(),
    source({ url: "https://www.igma.ru/m2.xlsx", course: 2 }),
    source({ url: "https://www.igma.ru/m3.xlsx", course: 3, sourceKind: "lecture" }),
    source({ url: "https://www.igma.ru/spring.xlsx", term: "spring" }),
    source({ url: "https://www.igma.ru/old.xlsx", academicYear: "2025-2026" }),
    source({ url: "https://www.igma.ru/m4.xlsx", course: 4 }),
    source({ url: "https://www.igma.ru/ped.xlsx", faculty: "pediatrics" }),
  ]);

  assert.deepEqual(selected.map((item) => item.url).sort(), [
    "https://www.igma.ru/images/medicine-1.xlsx",
    "https://www.igma.ru/m2.xlsx",
    "https://www.igma.ru/m3.xlsx",
  ].sort());
});

test("watch stays waiting without exact target sources and has no launch side effects", () => {
  const report = summarizeIzhgmuLaunchTarget({
    manifest: manifest([source({ academicYear: "2025-2026", term: "spring" })]),
  });
  assert.equal(report.status, "waiting");
  assert.equal(report.candidateSourceCount, 0);
  assert.equal(report.sourceSetDigest, null);
  assert.deepEqual(report.safety, {
    parsesSchedules: false,
    publishesSchedules: false,
    opensCatalog: false,
    opensTrials: false,
    opensSales: false,
  });
});

test("downloaded target sources produce a deterministic source-set digest", () => {
  const sources = [
    source(),
    source({ url: "https://www.igma.ru/m2.xlsx", course: 2, stream: "2" }),
  ];
  const files = sources.map((item, index) => ({
    ...item,
    status: "downloaded",
    filename: `0${index + 1}.xlsx`,
    spreadsheetKind: "xlsx",
    bytes: 100 + index,
    sha256: String(index + 1).repeat(64),
    finalUrl: item.url,
  }));
  const report = summarizeIzhgmuLaunchTarget({
    manifest: manifest(sources),
    downloadReport: { files },
  });

  assert.equal(report.status, "candidate");
  assert.equal(report.candidateSourceCount, 2);
  assert.equal(report.downloadedCount, 2);
  assert.match(report.sourceSetDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.coverage["1"].sourceCount, 1);
  assert.equal(report.coverage["2"].sourceCount, 1);
  assert.equal(report.coverage["3"].sourceCount, 0);
});

test("candidate with any failed download becomes review-required, never ready", () => {
  const target = source();
  const report = summarizeIzhgmuLaunchTarget({
    manifest: manifest([target]),
    downloadReport: {
      files: [{ ...target, status: "failed", error: "HTTP 500" }],
    },
  });
  assert.equal(report.status, "review-required");
  assert.equal(report.failedCount, 1);
  assert.equal(report.sourceSetDigest, null);
});

test("launch target is frozen to medicine courses 1-3 autumn 2026-2027", () => {
  assert.deepEqual(IZHGMU_LAUNCH_TARGET, {
    faculty: "medicine",
    courses: [1, 2, 3],
    academicYear: "2026-2027",
    term: "autumn",
  });
});
