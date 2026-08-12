import test from "node:test";
import assert from "node:assert/strict";
import { KgmuSourceWatcher } from "../src/adapters/kgmu/source-watcher.mjs";

test("production manual watcher observes official XLSX without invoking the server parser", async () => {
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
    foreign: "https://test.invalid/foreign",
  };
  const xlsxUrl = "https://test.invalid/files/medicine.xlsx";
  const html = `<a href="${xlsxUrl}">101-110 (первое полугодие 2026-2027 уч. г.)</a>`;
  const fetchFn = async (url) => {
    if (url === pages.medicine) return new Response(html, { status: 200 });
    if ([pages.pediatrics, pages.dentistry, pages.foreign].includes(url)) return new Response("<html></html>", { status: 200 });
    if (url === xlsxUrl) return new Response(Buffer.from("PK-reviewed-source"), { status: 200 });
    throw new Error(`unexpected url ${url}`);
  };

  let state = { version: 1, university: "kgmu", slots: {} };
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); return state; },
  };
  const observations = [];
  const sourceObserver = {
    observeSource: async (buffer, metadata) => {
      observations.push({ bytes: buffer.toString(), metadata });
      return { status: "REVIEW_REQUIRED", reviewId: "review-manual", parserType: "REVIEWED_JSON", notification: { sent: true } };
    },
  };
  const ingestService = {
    ingest: async () => {
      throw new Error("legacy XLSX parser must not be called in manual mode");
    },
  };
  const watcher = new KgmuSourceWatcher({
    config: {
      kgmuManualNormalization: true,
      kgmuParserRevision: "g20-reviewed-json-v1",
      offerAcademicYear: "2026/27",
      kgmuWatchSemesters: [1],
      kgmuMedicineSchedulePage: pages.medicine,
      kgmuPediatricsSchedulePage: pages.pediatrics,
      kgmuDentistrySchedulePage: pages.dentistry,
      kgmuForeignSchedulePage: pages.foreign,
    },
    ingestService,
    sourceObserver,
    stateStore,
    fetchFn,
  });

  const result = await watcher.run();
  assert.equal(result.status, "OK");
  assert.equal(result.mode, "MANUAL_NORMALIZATION");
  assert.equal(result.observedCount, 1);
  assert.equal(result.ingestedCount, 0);
  assert.equal(result.targetCount, 1);
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0].metadata, {
    filename: "medicine.xlsx",
    program: "medicine",
    course: 1,
    academicYear: "2026/27",
    semester: 1,
    groupRange: "101-110",
    sourceUrl: xlsxUrl,
  });
  assert.equal(result.results[0].status, "OBSERVED");
});
