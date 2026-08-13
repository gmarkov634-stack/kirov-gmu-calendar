import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { KgmuSourceWatcher } from "../src/adapters/kgmu/source-watcher.mjs";
import { publishScheduleBatch } from "../src/schedule/pipeline.js";
import { YearAwareStore } from "../src/year-aware-store.js";

function batch() {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "medicine",
      course: 1,
      group: "101",
      period: { start_date: "2026-09-01", end_date: "2026-12-28", week1_start_date: "2026-08-31" },
      source_files: ["1_lech.xlsx"],
      generated_at: null,
      parser: "chatgpt-rules",
      schedule_version_id: null,
      previous_schedule_version_id: null,
      content_fingerprint: null,
      version_created_at: null,
    },
    events: [{
      schema_version: "1.0",
      system: { event_id: null, schedule_version_id: null, fingerprint: null, revision: null, created_at: null, updated_at: null },
      university: { code: "kgmu", name: "Кировский ГМУ" },
      academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "medicine", faculty_name: "Лечебный факультет", course: 1 },
      audience: { group: "101", scope: "whole_group", subgroups: [], stream: null },
      timing: { date: "2026-09-14", start_time: "09:00", end_time: "10:30", all_day: false, time_mode: "floating" },
      lesson: {
        discipline: { raw: "АНАТОМИЯ", normalized: "Анатомия" },
        type: { raw: "практ.", code: "practice" },
        teachers: [], locations: [], source_note: null, cycle_id: null, joint_groups: [],
      },
      source: { file_name: "1_lech.xlsx", file_hash: "source-sha", sheet: "1 курс", references: [{ role: "lesson", range: "D18:H18" }], raw_text: null },
      parse: { status: "ok", rule_ids: [], warnings: [] },
      derived: {
        academic_week: null,
        sequence: { index: null, total: null, bucket: null },
        next_same_event: null,
        is_last_same_event: false,
        day: { index: null, total: null, remaining: null, next_event: null, gap_minutes: null, overlaps_next: false },
        cycle: null,
        assessment: null,
      },
      calendar: { title: null, description: null, location: null },
    }],
  };
}

const scheduleContext = {
  university: "kgmu",
  program: "medicine",
  course: 1,
  groupCode: "101",
  groupId: "kgmu:medicine:1:101",
  academicYear: "2026/2027",
  semester: 1,
};

function watcherConfig(pages) {
  return {
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    kgmuWatchSemesters: [1],
    kgmuMedicineSchedulePage: pages.medicine,
    kgmuPediatricsSchedulePage: pages.pediatrics,
    kgmuDentistrySchedulePage: pages.dentistry,
    kgmuForeignSchedulePage: pages.foreign,
    kgmuParserRevision: "source-disappearance-regression",
  };
}

async function setupPublishedSchedule(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-source-disappearance-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = new YearAwareStore({ dataDir, cacheTtlMs: 0, offerAcademicYear: "2026/2027", offerSemester: 1 });
  const publication = await publishScheduleBatch({
    store,
    incomingBatch: batch(),
    now: "2026-08-13T17:00:00.000Z",
    eventIdFactory: () => "evt_source_disappearance_1",
    versionIdFactory: () => "ver_source_disappearance_1",
  });
  const before = await store.getSchedule(scheduleContext);
  assert.equal(before.events.length, 1);
  return { store, before, publication };
}

function seededWatcherState() {
  return {
    version: 1,
    university: "kgmu",
    slots: {
      "medicine:1:2026/27:1:101-110": {
        sha256: "known-source-sha",
        parserRevision: "source-disappearance-regression",
        url: "https://test.invalid/files/1_lech.xlsx",
        label: "101-110 (первое полугодие 2026-2027 уч. г.)",
        program: "medicine",
        course: 1,
        groupRange: "101-110",
        academicYear: "2026/27",
        semester: 1,
        lastSeenAt: "2026-08-13T16:00:00.000Z",
        lastIngestedAt: "2026-08-13T16:00:00.000Z",
        ingestStatus: "READY_TO_PUBLISH",
      },
    },
  };
}

async function assertPublicationUnchanged(store, before) {
  const after = await store.getSchedule(scheduleContext);
  assert.equal(after.schedule.schedule_version_id, before.schedule.schedule_version_id);
  assert.equal(after.schedule.content_fingerprint, before.schedule.content_fingerprint);
  assert.equal(after.events.length, 1);
  assert.equal(after.events[0].system.event_id, before.events[0].system.event_id);
}

test("removing a KGMU XLSX link never becomes an empty published schedule", async (t) => {
  const { store, before } = await setupPublishedSchedule(t);
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
    foreign: "https://test.invalid/foreign",
  };
  const fetchFn = async (url) => {
    if (Object.values(pages).includes(url)) return new Response("<html><body>temporarily no schedule link</body></html>", { status: 200 });
    throw new Error(`unexpected url ${url}`);
  };
  let state = seededWatcherState();
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); return state; },
  };
  let ingestCalls = 0;
  const watcher = new KgmuSourceWatcher({
    config: watcherConfig(pages),
    ingestService: { ingest: async () => { ingestCalls += 1; throw new Error("source disappearance must not ingest or publish"); } },
    stateStore,
    fetchFn,
  });

  const result = await watcher.run();
  assert.equal(result.status, "OK");
  assert.equal(result.targetCount, 0);
  assert.equal(result.ingestedCount, 0);
  assert.equal(ingestCalls, 0);
  assert.equal(state.slots["medicine:1:2026/27:1:101-110"].sha256, "known-source-sha");
  await assertPublicationUnchanged(store, before);
});

test("an unavailable KGMU XLSX URL never replaces the last published schedule", async (t) => {
  const { store, before } = await setupPublishedSchedule(t);
  const pages = {
    medicine: "https://test.invalid/medicine",
    pediatrics: "https://test.invalid/pediatrics",
    dentistry: "https://test.invalid/dentistry",
    foreign: "https://test.invalid/foreign",
  };
  const xlsxUrl = "https://test.invalid/files/1_lech.xlsx";
  const medicineHtml = `<a href="${xlsxUrl}">101-110 (первое полугодие 2026-2027 уч. г.)</a>`;
  const fetchFn = async (url) => {
    if (url === pages.medicine) return new Response(medicineHtml, { status: 200 });
    if ([pages.pediatrics, pages.dentistry, pages.foreign].includes(url)) return new Response("<html></html>", { status: 200 });
    if (url === xlsxUrl) return new Response("temporarily unavailable", { status: 404 });
    throw new Error(`unexpected url ${url}`);
  };
  let state = seededWatcherState();
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); return state; },
  };
  let ingestCalls = 0;
  const watcher = new KgmuSourceWatcher({
    config: watcherConfig(pages),
    ingestService: { ingest: async () => { ingestCalls += 1; throw new Error("unavailable source must not ingest or publish"); } },
    stateStore,
    fetchFn,
  });

  const result = await watcher.run();
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.targetCount, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(result.ingestedCount, 0);
  assert.equal(ingestCalls, 0);
  assert.match(result.errors[0].error, /XLSX HTTP 404/);
  assert.equal(state.slots["medicine:1:2026/27:1:101-110"].sha256, "known-source-sha");
  await assertPublicationUnchanged(store, before);
});
