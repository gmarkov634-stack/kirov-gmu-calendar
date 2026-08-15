import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  buildCombinedRotationCanonicalCandidate,
  parseCombinedRotationGeometry,
} from "../src/adapters/omgmu/combined-rotation-table.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const encoded = fs.readFileSync(path.join(__dirname, "fixtures/omgmu-combined-course5.geometry.json.gz.b64"), "utf8").trim();
const geometry = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
const SOURCE_HASH = "6b7862a6aa7fb2a0cca00b9e965eccdeea9ece8825d58da15a6e03b1b38fd328";

const metadata = {
  academicYear: "2025/2026",
  semester: "spring",
  facultyCode: "medicine-international",
  facultyName: "Лечебное дело для иностранных граждан",
  course: 5,
  group: "585",
  period: { start_date: "2026-04-06", end_date: "2026-08-08", week1_start_date: "2026-04-06" },
  calendarExceptions: ["2026-05-01", "2026-05-09", "2026-06-12"],
};

const source = {
  fileName: "08_medicine-international_course-5_combined.pdf",
  fileHash: SOURCE_HASH,
};

test("real geometry proves page-4 O69 column-schema inheritance for group 585", () => {
  assert.equal(geometry.sourceLanguage, "ru");
  assert.equal(geometry.columnSchema.groupCode, "585");
  assert.equal(geometry.pages.length, 2);
  assert.equal(geometry.pages[0].pageNumber, 3);
  assert.equal(geometry.pages[0].schemaInherited, false);
  assert.equal(geometry.pages[0].schemaFromPage, 3);
  assert.equal(geometry.pages[1].pageNumber, 4);
  assert.equal(geometry.pages[1].schemaInherited, true);
  assert.equal(geometry.pages[1].schemaFromPage, 3);
  assert.equal(geometry.pages[0].rows.length, 10);
  assert.equal(geometry.pages[1].rows.length, 6);

  const roles = geometry.columnSchema.roles;
  assert.deepEqual([roles.time.x0, roles.time.x1], [200.64, 236.04]);
  assert.deepEqual([roles.kDays.x0, roles.kDays.x1], [236.04, 265.08]);
  assert.deepEqual([roles.group.x0, roles.group.x1], [265.08, 414.15]);
  assert.ok(geometry.pages[1].rows.every((row) => row.groupCode === "585"));
  assert.ok(geometry.pages[1].rows.every((row) => row.groupBbox[0] === 265.08 && row.groupBbox[2] === 414.15));
});

test("parses all 16 source rows with matching K.дн. and no diagnostics", () => {
  const parsed = parseCombinedRotationGeometry(geometry, {
    year: 2026,
    calendarExceptions: metadata.calendarExceptions,
  });
  assert.equal(parsed.group, "585");
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.sourceSeries.length, 16);
  assert.ok(parsed.sourceSeries.every((record) => record.status === "ok"));
  assert.ok(parsed.sourceSeries.every((record) => record.mainDates.length === record.declaredDays));

  const page4 = parsed.sourceSeries.filter((record) => record.geometry.pageNumber === 4);
  assert.equal(page4.length, 6);
  assert.ok(page4.every((record) => record.ruleIds.includes("O69")));
  assert.ok(parsed.sourceSeries.filter((record) => record.geometry.pageNumber === 3).every((record) => !record.ruleIds.includes("O69")));
});

test("O70 keeps the final cycle series intact when credit stands between range and type marker", () => {
  const parsed = parseCombinedRotationGeometry(geometry, {
    year: 2026,
    calendarExceptions: metadata.calendarExceptions,
  });
  const finalCycle = parsed.sourceSeries.find((record) => (
    record.discipline.includes("Госпитальная терапия") && record.kind === "cycle"
  ));

  assert.ok(finalCycle);
  assert.equal(finalCycle.mainRange, "24.07-07.08");
  assert.equal(finalCycle.mainDates.length, 11);
  assert.equal(finalCycle.declaredDays, 11);
  assert.deepEqual(finalCycle.control, { date: "2026-08-07", explicitTime: null });
  assert.equal(finalCycle.o70Composite, true);
  assert.ok(finalCycle.ruleIds.includes("O69"));
  assert.ok(finalCycle.ruleIds.includes("O70"));
  assert.ok(finalCycle.ruleIds.includes("O29"));
  assert.ok(finalCycle.ruleIds.includes("O30"));
  assert.equal(finalCycle.status, "ok");
});

test("full real group 585 produces 154 canonical events and passes the shared pipeline", () => {
  const candidate = buildCombinedRotationCanonicalCandidate(geometry, { metadata, source });
  assert.equal(candidate.group, "585");
  assert.equal(candidate.sourceSeries.length, 16);
  // Fifteen ordinary source rows materialize one user-series each. The final
  // O70 composite row becomes one cycle user-series for 24.07-06.08 plus one
  // credit user-series for 07.08 under O29, while still representing 11 dates.
  assert.equal(candidate.userSeries.length, 17);
  assert.equal(candidate.batch.events.length, 154);
  assert.ok(candidate.batch.events.every((event) => event.university.code === "omgmu"));
  assert.ok(candidate.batch.events.every((event) => event.audience.group === "585"));
  assert.ok(candidate.batch.events.every((event) => event.timing.time_mode === "floating"));
  assert.ok(candidate.batch.events.every((event) => event.source.file_name === source.fileName));
  assert.ok(candidate.batch.events.every((event) => event.source.file_hash === SOURCE_HASH));
  assert.ok(candidate.batch.events.every((event) => event.parse.status === "ok"));

  const august7Therapy = candidate.batch.events.filter((event) => (
    event.timing.date === "2026-08-07" && event.lesson.discipline.normalized.includes("Госпитальная терапия")
  ));
  assert.equal(august7Therapy.length, 2);
  const lecture = august7Therapy.find((event) => event.lesson.type.code === "lecture");
  const credit = august7Therapy.find((event) => event.lesson.type.code === "credit");
  assert.ok(lecture);
  assert.ok(credit);
  assert.equal(credit.timing.start_time, "10:40");
  assert.equal(credit.timing.end_time, "13:50");
  assert.ok(credit.parse.rule_ids.includes("O70"));
  assert.ok(credit.parse.rule_ids.includes("O29"));
  assert.equal(august7Therapy.some((event) => event.lesson.type.raw === "циклы"), false);

  let eventNo = 0;
  const prepared = prepareSchedulePublication(candidate.batch, {
    now: "2026-08-15T10:00:00.000Z",
    eventIdFactory: () => `evt_omgmu_585_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_585_combined_1",
  });
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal(prepared.diff.counts.added, 154);
  assert.equal(prepared.batch.events.length, 154);
  assert.match(prepared.ics, /DTSTART:20260406T082000/);
  assert.match(prepared.ics, /DTSTART:20260807T104000/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /\+06:00/);
});

test("headerless continuation fails closed when O69 schema evidence is missing", () => {
  const broken = structuredClone(geometry);
  broken.pages[1].schemaFromPage = null;
  const parsed = parseCombinedRotationGeometry(broken, {
    year: 2026,
    calendarExceptions: metadata.calendarExceptions,
  });
  assert.ok(parsed.diagnostics.some((warning) => warning.includes("inherited schema has no source page")));
  assert.throws(
    () => buildCombinedRotationCanonicalCandidate(broken, { metadata, source }),
    (error) => error.code === "OMG_COMBINED_ROTATION_NEEDS_REVIEW",
  );
});

test("rejects non-Russian combined geometry for production", () => {
  assert.throws(
    () => parseCombinedRotationGeometry({ ...geometry, sourceLanguage: "en" }, { year: 2026 }),
    (error) => error.code === "OMG_COMBINED_ROTATION_RU_REQUIRED",
  );
});
