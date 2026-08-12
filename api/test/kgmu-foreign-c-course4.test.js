import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCycleWorkbook } from "../src/adapters/kgmu/foreign-c-parser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
function loadFixture() {
  const parts = [1, 2, 3, 4].map((part) => fs.readFileSync(
    path.join(here, "fixtures", `kgmu-foreign-course4-2025-26.part${part}.b64`),
    "utf8",
  ).trim());
  return JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8"));
}

test("C-FIO course 4 preserves styled cycle days and standalone PE schedule", () => {
  const workbook = loadFixture();
  const classification = classifyKgmuWorkbook(workbook);
  assert.equal(classification.type, "C");
  assert.deepEqual(classification.features.groupCodes, ["401и", "402и", "403и", "404и", "405и", "406и"]);

  const result = parseKgmuForeignCycleWorkbook(workbook, {
    program: "foreign", course: 4, academicYear: "2025/26", semester: 2,
  });
  assert.equal(result.type, "C");
  assert.equal(result.profile, "C-FIO");
  assert.equal(result.qa.passed, true);
  assert.equal(result.qa.sourceBlocks, 54);
  assert.equal(result.qa.coveredSourceBlocks, 54);
  assert.equal(result.qa.styledSubjectDayCount, 475);
  assert.deepEqual(result.qa.groupSubjectDays, {
    "401и": 79, "402и": 79, "403и": 80, "404и": 79, "405и": 79, "406и": 79,
  });
  assert.equal(result.qa.eventCount, 571);
  assert.deepEqual(result.qa.groupCounts, {
    "401и": 95, "402и": 95, "403и": 96, "404и": 95, "405и": 95, "406и": 95,
  });
  assert.equal(result.qa.duplicateCount, 0);
  assert.equal(result.qa.allowedOverlapCount, 6);
  assert.equal(result.qa.remainingOverlaps.length, 0);
  assert.deepEqual(result.qa.allowedOverlaps.map((item) => `${item.group}|${item.date}`), [
    "401и|2026-03-19",
    "402и|2026-04-02",
    "403и|2026-04-23",
    "404и|2026-05-07",
    "405и|2026-02-12",
    "406и|2026-03-05",
  ]);

  const events = result.schedules.flatMap((schedule) => schedule.events.map((event) => ({ ...event, group: schedule.group.code })));
  assert.ok(events.some((event) => event.group === "401и" && event.title === "Faculty Therapy, Professional diseases" && event.start === "2026-02-02T13:00:00+03:00"));
  assert.ok(events.some((event) => event.group === "404и" && event.title === "Otorhinolaryngology" && event.start === "2026-02-02T12:00:00+03:00"));

  // Neurology continues after a white individual-work day: 30 Apr -> gap 2 May -> 4 May.
  assert.ok(events.some((event) => event.group === "401и" && event.title === "Neurology, Neurosurgery" && event.start.startsWith("2026-04-30T")));
  assert.ok(!events.some((event) => event.group === "401и" && event.title === "Neurology, Neurosurgery" && event.start.startsWith("2026-05-02T")));
  assert.ok(events.some((event) => event.group === "401и" && event.title === "Neurology, Neurosurgery" && event.start.startsWith("2026-05-04T")));

  const pe401 = events.filter((event) => event.group === "401и" && event.kind === "physical_education");
  assert.equal(pe401.length, 16);
  assert.equal(pe401[0].start, "2026-02-05T09:00:00+03:00");
  assert.equal(pe401.at(-1).start, "2026-05-21T09:00:00+03:00");

  assert.ok(events.some((event) => event.group === "405и" && event.title === "Urology (module)" && event.assessment === "exam"));
  assert.ok(!events.some((event) => /^exams?$/i.test(event.title)));
  assert.ok(!events.some((event) => event.kind === "lecture"));
});
