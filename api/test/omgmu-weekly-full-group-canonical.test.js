import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { buildWeeklyGridCanonicalCandidate } from "../src/adapters/omgmu/weekly-grid.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function geometryFixture(name) {
  const encoded = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8").trim();
  return JSON.parse(zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

function metadata({ course, stream, group }) {
  return {
    academicYear: "2025/2026",
    semester: "spring",
    facultyCode: "medicine-international",
    facultyName: "Лечебное дело для иностранных граждан",
    course,
    stream,
    group,
    period: {
      start_date: "2026-04-01",
      end_date: "2026-08-08",
      week1_start_date: "2026-03-30",
    },
    calendarExceptions: ["2026-05-01", "2026-05-09", "2026-06-12"],
  };
}

function runFullGroup({ fixture, course, stream, group, fileName, fileHash }) {
  const candidate = buildWeeklyGridCanonicalCandidate(geometryFixture(fixture), {
    metadata: metadata({ course, stream, group }),
    source: { fileName, fileHash },
  });

  assert.equal(candidate.review, null);
  assert.ok(candidate.sourceSeries.length > 0);
  assert.ok(candidate.sourceSeries.every((series) => series.status !== "needs_review"));
  assert.ok(candidate.batch.events.length >= candidate.sourceSeries.length);
  assert.ok(candidate.batch.events.every((event) => event.university.code === "omgmu"));
  assert.ok(candidate.batch.events.every((event) => event.audience.group === group));
  assert.ok(candidate.batch.events.every((event) => event.timing.time_mode === "floating"));
  assert.ok(candidate.batch.events.every((event) => event.source.file_name === fileName));
  assert.ok(candidate.batch.events.every((event) => event.source.file_hash === fileHash));
  assert.ok(candidate.batch.events.every((event) => event.source.references.length > 0));
  assert.ok(candidate.batch.events.every((event) => event.source.references.some((ref) => ref.range.startsWith("pdf:p2:"))));

  let eventNo = 0;
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: "2026-08-15T09:00:00.000Z",
    eventIdFactory: () => `evt_omgmu_weekly_${group}_${++eventNo}`,
    versionIdFactory: () => `ver_omgmu_weekly_${group}_1`,
  });

  assert.equal(prepared.context.university, "omgmu");
  assert.equal(prepared.context.groupCode, group);
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal(prepared.diff.counts.added, candidate.batch.events.length);
  assert.equal(prepared.batch.events.length, candidate.batch.events.length);
  assert.match(prepared.ics, /BEGIN:VEVENT/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /\+06:00/);
  assert.ok(prepared.batch.events.every((event) => event.system.event_id));
  assert.ok(prepared.batch.events.every((event) => event.calendar.title));

  return { candidate, prepared };
}

test("full real weekly_grid group 2101 passes canonical common pipeline", () => {
  const { candidate, prepared } = runFullGroup({
    fixture: "omgmu-weekly-course2-stream1.geometry.json.gz.b64",
    course: 2,
    stream: "1",
    group: "2101",
    fileName: "03_medicine-international_course-2_stream-1_combined.pdf",
    fileHash: "f34129fe1a98ca8935620fce10b3adab7ca3858e5f5e842fe38bcfc85491d3da",
  });

  assert.equal(candidate.groups.length, 10);
  assert.ok(candidate.batch.events.length > 50);
  assert.equal(candidate.merges.length, 0);
  assert.match(prepared.ics, /UID:evt_omgmu_weekly_2101_/);
});

test("full real weekly_grid group 385 passes canonical common pipeline", () => {
  const { candidate, prepared } = runFullGroup({
    fixture: "omgmu-weekly-course3.geometry.json.gz.b64",
    course: 3,
    stream: null,
    group: "385",
    fileName: "05_medicine-international_course-3_combined.pdf",
    fileHash: "5a77c3eaede8e32887bc8c768cb19b5aaa6d9506249b2484ffb0bbb2f3bc9427",
  });

  assert.equal(candidate.groups.length, 8);
  assert.ok(candidate.batch.events.length > 50);
  assert.equal(candidate.merges.length, 0);
  assert.match(prepared.ics, /UID:evt_omgmu_weekly_385_/);
});
