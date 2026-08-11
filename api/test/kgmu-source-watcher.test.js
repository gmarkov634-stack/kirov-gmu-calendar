import test from "node:test";
import assert from "node:assert/strict";
import { discoverKgmuScheduleLinks, KgmuSourceWatcher } from "../src/adapters/kgmu/source-watcher.mjs";

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

test("watcher filters target period and ingests only changed SHA", async () => {
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
  };
  const xlsxUrl = "https://test.invalid/files/medicine.xlsx";
  const medicineHtml = [
    `<a href="${xlsxUrl}">101-110 (первое полугодие 2026-2027 уч. г.)</a>`,
    `<a href="/files/old.xlsx">101-110 (второе полугодие 2025-2026 уч. г.)</a>`,
  ].join("\n");
  let xlsxBody = Buffer.from("PK-new-schedule-v1");
  const fetchFn = async (url) => {
    if (url === pages.medicine) return new Response(medicineHtml, { status: 200, headers: { "content-type": "text/html" } });
    if (url === pages.pediatrics || url === pages.dentistry) return new Response("<html></html>", { status: 200 });
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
    kgmuMedicineSchedulePage: pages.medicine,
    kgmuPediatricsSchedulePage: pages.pediatrics,
    kgmuDentistrySchedulePage: pages.dentistry,
  };
  const watcher = new KgmuSourceWatcher({ config, ingestService, stateStore, fetchFn });

  const first = await watcher.run();
  assert.equal(first.targetCount, 1);
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
