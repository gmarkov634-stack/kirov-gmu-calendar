import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(new URL("./fixtures/omgmu-historical-regression.v1.json", import.meta.url));
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

function profile(name) {
  return manifest.profiles.find((item) => item.profile === name);
}

test("historical gate pins exactly the four approved ОмГМУ source profiles", () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.university, "omgmu");
  assert.equal(manifest.network, "forbidden");
  assert.deepEqual(
    manifest.profiles.map((item) => item.profile).sort(),
    ["combined_rotation_table", "course_lecture_list", "cycle_rotation_grid", "weekly_grid"],
  );
});

test("historical gate pins reviewed source SHA and event-count anchors", () => {
  const lecture = profile("course_lecture_list");
  assert.equal(lecture.sourceSha256, "6e8cf99d14f53eb2a441cff588d39e619574863d8e5d12b08f4939113ac906fe");
  assert.equal(lecture.expectedSourceSeries, 20);
  assert.equal(lecture.expectedEvents, 69);

  const weekly = profile("weekly_grid");
  assert.deepEqual(weekly.anchors, [
    { group: "2101", sourceSha256: "f34129fe1a98ca8935620fce10b3adab7ca3858e5f5e842fe38bcfc85491d3da" },
    { group: "385", sourceSha256: "5a77c3eaede8e32887bc8c768cb19b5aaa6d9506249b2484ffb0bbb2f3bc9427" },
  ]);

  const cycle = profile("cycle_rotation_grid");
  assert.equal(cycle.sourceSha256, "d3436fb8a1f40b4286ffd550004e477424c9424590128dbbf564340200c38daa");
  assert.equal(cycle.group, "485");
  assert.equal(cycle.expectedSourceSeries, 10);
  assert.equal(cycle.expectedEvents, 106);

  const combined = profile("combined_rotation_table");
  assert.equal(combined.sourceSha256, "6b7862a6aa7fb2a0cca00b9e965eccdeea9ece8825d58da15a6e03b1b38fd328");
  assert.equal(combined.group, "585");
  assert.equal(combined.expectedSourceSeries, 16);
  assert.equal(combined.expectedEvents, 154);
});

test("historical gate retains profile-specific and fail-closed evidence", () => {
  const all = new Set([
    ...manifest.profiles.flatMap((item) => item.tests || []),
    ...(manifest.failClosedTests || []),
    ...(manifest.sharedCoreTests || []),
  ]);
  for (const required of [
    "test/omgmu-course-lecture-fail-closed.test.js",
    "test/omgmu-weekly-geometry-canonical.test.js",
    "test/omgmu-weekly-reviewed-canonical.test.js",
    "test/omgmu-cycle-rotation-canonical.test.js",
    "test/omgmu-combined-rotation-canonical.test.js",
    "test/omgmu-source-version.test.js",
    "test/omgmu-source-review-watcher.test.js",
    "test/omgmu-source-bound-canonical-review.test.js",
    "test/omgmu-legacy-direct-publication-retired.test.js",
    "test/schedule-pipeline.test.js",
    "test/schedule-ics.test.js",
    "test/schedule-versioning.test.js",
    "test/multi-university-flow.test.js",
  ]) assert.ok(all.has(required), `missing historical evidence: ${required}`);
});

test("historical gate cannot depend on live discovery, download or source watch", () => {
  const selected = new Set([
    ...manifest.profiles.flatMap((item) => item.tests || []),
    ...(manifest.failClosedTests || []),
    ...(manifest.sharedCoreTests || []),
  ]);
  for (const forbidden of manifest.forbiddenTests) assert.equal(selected.has(forbidden), false, `live test selected: ${forbidden}`);
});
