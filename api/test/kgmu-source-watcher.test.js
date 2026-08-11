import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { discoverKgmuScheduleLinks, KgmuSourceWatcher } from "../src/adapters/kgmu/source-watcher.mjs";

test("KGMU watcher defaults to both semesters independently of semester offer", () => {
  const config = loadConfig({ OFFER_ACADEMIC_YEAR: "2026/27", OFFER_SEMESTER: "1" });
  assert.equal(config.offerSemester, 1);
  assert.deepEqual(config.kgmuWatchSemesters, [1, 2]);
  assert.equal(config.kgmuForeignSchedulePage, "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya");
});

test("discovers KGMU XLSX metadata from schedule link label", () => {
  const html = `<a href="/sites/default/files/files/2026/08/20/1200/1_lech.xlsx">101-110 (первое полугодие 2026-2027 уч. г.)</a>`;
  const [source] = discoverKgmuScheduleLinks(html, { program: "medicine", url: "https://kirovgma.ru/lechebnyy-fakultet-raspisanie" });
  assert.equal(source.program, "medicine");
  assert.equal(source.course, 1);
  assert.equal(source.groupRange, "101-110");
  assert.equal(source.academicYear, "2026/27");
  assert.equal(source.semester, 1);
  assert.equal(source.url, "https://kirovgma.ru/sites/default/files/files/2026/08/20/1200/1_lech.xlsx");
});

test("discovers Russian and English foreign-student labels into one canonical group range", () => {
  const html = [
    `<a href="/files/fio-ru.xlsx">101и-110и (первое полугодие 2026-2027 уч. г.)</a>`,
    `<a href="/files/fio-en.xlsx">101i-110i (1 semester 2026-2027 academic year)</a>`,
  ].join("\n");
  const sources = discoverKgmuScheduleLinks(html, {
    program: "foreign",
    url: "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya",
  });
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((source) => source.groupRange), ["101и-110и", "101и-110и"]);
  assert.deepEqual(sources.map((source) => source.sourceLocale), ["ru", "en"]);
  assert.deepEqual(sources.map((source) => source.semester), [1, 1]);
  assert.deepEqual(sources.map((source) => source.course), [1, 1]);
});

test("watcher filters target period and ingests only changed SHA", async () => {
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
    foreign: "https://test.invalid/foreign",
  };
  const xlsxUrl = "https://test.invalid/files/medicine.xlsx";
  const medicineHtml = [
    `<a href="${xlsxUrl}">101-110 (первое полугодие 2026-2027 уч. г.)</a>`,
    `<a href="/files/old.xlsx">101-110 (второе полугодие 2025-2026 уч. г.)</a>`,
  ].join("\n");
  let xlsxBody = Buffer.from("PK-new-schedule-v1");
  const fetchFn = async (url) => {
    if (url === pages.medicine) return new Response(medicineHtml, { status: 200, headers: { "content-type": "text/html" } });
    if ([pages.pediatrics, pages.dentistry, pages.foreign].includes(url)) return new Response("<html></html>", { status: 200 });
    if (url === xlsxUrl) return new Response(xlsxBody, { status: 200 });
    throw new Error(`unexpected url ${url}`);
  };
  let state = { version: 1, university: "kgmu", slots: {} };
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); return state; },
  };
  const calls = [];
  const ingestService = {
    ingest: async (buffer, metadata) => {
      calls.push({ buffer: buffer.toString(), metadata });
      return { status: "READY_TO_PUBLISH", reviewId: `review-${calls.length}`, parserType: "R", classification: { type: "R" } };
    },
  };
  const config = {
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    kgmuWatchSemesters: [1],
    kgmuMedicineSchedulePage: pages.medicine,
    kgmuPediatricsSchedulePage: pages.pediatrics,
    kgmuDentistrySchedulePage: pages.dentistry,
    kgmuForeignSchedulePage: pages.foreign,
  };
  const watcher = new KgmuSourceWatcher({ config, ingestService, stateStore, fetchFn });

  const first = await watcher.run();
  assert.equal(first.status, "OK");
  assert.equal(first.targetCount, 1);
  assert.deepEqual(first.expectedSemesters, [1]);
  assert.equal(first.ingestedCount, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].metadata, {
    filename: "medicine.xlsx",
    program: "medicine",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
  });

  const second = await watcher.run();
  assert.equal(second.ingestedCount, 0);
  assert.equal(second.unchangedCount, 1);
  assert.equal(calls.length, 1);

  xlsxBody = Buffer.from("PK-new-schedule-v2");
  const third = await watcher.run();
  assert.equal(third.ingestedCount, 1);
  assert.equal(calls.length, 2);
});

test("watcher prefers Russian foreign-student XLSX over English mirror", async () => {
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
    foreign: "https://test.invalid/foreign",
  };
  const ruUrl = "https://test.invalid/files/fio-ru.xlsx";
  const enUrl = "https://test.invalid/files/fio-en.xlsx";
  const foreignHtml = [
    `<a href="${ruUrl}">101и-110и (первое полугодие 2026-2027 уч. г.)</a>`,
    `<a href="${enUrl}">101i-110i (1 semester 2026-2027 academic year)</a>`,
  ].join("\n");
  const downloaded = [];
  const fetchFn = async (url) => {
    if ([pages.medicine, pages.pediatrics, pages.dentistry].includes(url)) return new Response("<html></html>", { status: 200 });
    if (url === pages.foreign) return new Response(foreignHtml, { status: 200 });
    if (url === ruUrl) { downloaded.push("ru"); return new Response(Buffer.from("PK-fio-ru"), { status: 200 }); }
    if (url === enUrl) { downloaded.push("en"); return new Response(Buffer.from("PK-fio-en"), { status: 200 }); }
    throw new Error(`unexpected url ${url}`);
  };
  let state = { version: 1, university: "kgmu", slots: {} };
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); return state; },
  };
  const calls = [];
  const ingestService = {
    ingest: async (_buffer, metadata) => {
      calls.push(metadata);
      return { status: "REVIEW_REQUIRED", reviewId: "review-foreign", classification: { type: "UNKNOWN" } };
    },
  };
  const watcher = new KgmuSourceWatcher({
    config: {
      offerAcademicYear: "2026/27",
      kgmuWatchSemesters: [1, 2],
      kgmuMedicineSchedulePage: pages.medicine,
      kgmuPediatricsSchedulePage: pages.pediatrics,
      kgmuDentistrySchedulePage: pages.dentistry,
      kgmuForeignSchedulePage: pages.foreign,
    },
    ingestService,
    stateStore,
    fetchFn,
  });
  const result = await watcher.run();
  assert.equal(result.status, "OK");
  assert.equal(result.discoveredCount, 2);
  assert.equal(result.targetCount, 1);
  assert.deepEqual(downloaded, ["ru"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    filename: "fio-ru.xlsx",
    program: "foreign",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
  });
});

test("watcher can monitor both semesters of one academic year without changing semester offer", async () => {
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
    foreign: "https://test.invalid/foreign",
  };
  const firstUrl = "https://test.invalid/files/medicine-fall.xlsx";
  const secondUrl = "https://test.invalid/files/medicine-spring.xlsx";
  const medicineHtml = [
    `<a href="${firstUrl}">101-110 (первое полугодие 2026-2027 уч. г.)</a>`,
    `<a href="${secondUrl}">101-110 (второе полугодие 2026-2027 уч. г.)</a>`,
    `<a href="/files/old.xlsx">101-110 (второе полугодие 2025-2026 уч. г.)</a>`,
  ].join("\n");
  const fetchFn = async (url) => {
    if (url === pages.medicine) return new Response(medicineHtml, { status: 200 });
    if ([pages.pediatrics, pages.dentistry, pages.foreign].includes(url)) return new Response("<html></html>", { status: 200 });
    if (url === firstUrl) return new Response(Buffer.from("PK-fall"), { status: 200 });
    if (url === secondUrl) return new Response(Buffer.from("PK-spring"), { status: 200 });
    throw new Error(`unexpected url ${url}`);
  };
  let state = { version: 1, university: "kgmu", slots: {} };
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); return state; },
  };
  const calls = [];
  const ingestService = {
    ingest: async (_buffer, metadata) => {
      calls.push(metadata);
      return { status: "READY_TO_PUBLISH", reviewId: `review-${calls.length}`, parserType: "R", classification: { type: "R" } };
    },
  };
  const config = {
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    kgmuWatchSemesters: [1, 2],
    kgmuMedicineSchedulePage: pages.medicine,
    kgmuPediatricsSchedulePage: pages.pediatrics,
    kgmuDentistrySchedulePage: pages.dentistry,
    kgmuForeignSchedulePage: pages.foreign,
  };
  const watcher = new KgmuSourceWatcher({ config, ingestService, stateStore, fetchFn });
  const result = await watcher.run();

  assert.deepEqual(result.expectedSemesters, [1, 2]);
  assert.equal(result.targetCount, 2);
  assert.equal(result.ingestedCount, 2);
  assert.deepEqual(calls.map((item) => item.semester).sort(), [1, 2]);
  assert.equal(config.offerSemester, 1);
});
