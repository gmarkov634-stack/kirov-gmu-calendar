import assert from "node:assert/strict";
import test from "node:test";
import { buildOmgmuCanonicalBatch } from "../src/adapters/omgmu/canonical.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

const sourceHash = "a".repeat(64);

function incomingBatch() {
  return buildOmgmuCanonicalBatch({
    metadata: {
      academicYear: "2025-2026",
      semester: 2,
      facultyCode: "medicine-international",
      facultyName: "Лечебное дело для иностранных граждан",
      course: 4,
      groupCode: "485",
      period: {
        start_date: "2026-02-02",
        end_date: "2026-08-07",
        week1_start_date: "2026-02-02",
      },
      parser: "omgmu-course-lecture-list/o01-o72",
    },
    source: {
      fileName: "4lek.pdf",
      fileHash: sourceHash,
    },
    series: [
      {
        discipline: "Акушерство и гинекология",
        kind: "lecture",
        startTime: "11.00",
        endTime: "12.40",
        dates: ["2026-04-06"],
        location: "БУЗОО «КРД № 6», ул. Перелета, 3",
        rawSource: "11.00-12.40 Акушерство и гинекология, 1 лекция: 06.04 - БУЗОО «КРД № 6», ул. Перелета,3",
        references: [{ role: "lesson", range: "ru:p2:monday:series-2" }],
        ruleIds: ["O24", "O27", "O58", "O67", "O68", "O72"],
      },
      {
        discipline: "Педиатрия",
        kind: "lecture",
        startTime: "11:00",
        endTime: "12:40",
        dates: ["2026-04-13", "2026-04-20", "2026-04-27"],
        rawSource: "11.00-12.40 Педиатрия, 3 лекции: 13.04-27.04",
        references: [{ role: "lesson", range: "ru:p2:monday:series-3" }],
        ruleIds: ["O24", "O27", "O68", "O72"],
      },
    ],
  });
}

test("builds an ОмГМУ schedule-batch/v1 with floating timing and O-rule evidence", () => {
  const batch = incomingBatch();
  assert.equal(batch.schema_version, "1.0");
  assert.equal(batch.schedule.university_code, "omgmu");
  assert.equal(batch.schedule.academic_year, "2025/2026");
  assert.equal(batch.schedule.semester, "spring");
  assert.equal(batch.schedule.faculty_code, "medicine-international");
  assert.equal(batch.schedule.group, "485");
  assert.deepEqual(batch.schedule.source_files, ["4lek.pdf"]);
  assert.equal(batch.events.length, 4);

  const first = batch.events[0];
  assert.equal(first.university.code, "omgmu");
  assert.equal(first.audience.group, "485");
  assert.equal(first.timing.time_mode, "floating");
  assert.equal(first.timing.start_time, "11:00");
  assert.equal(first.timing.end_time, "12:40");
  assert.equal(first.lesson.type.code, "lecture");
  assert.equal(first.source.file_name, "4lek.pdf");
  assert.equal(first.source.file_hash, sourceHash);
  assert.ok(first.parse.rule_ids.includes("O72"));
  assert.equal(first.system.event_id, null);
  assert.equal(first.calendar.title, null);
});

test("passes the same shared publication pipeline used by КГМУ", () => {
  let eventNo = 0;
  const prepared = prepareSchedulePublication(incomingBatch(), {
    now: "2026-08-14T20:30:00.000Z",
    eventIdFactory: () => `evt_omgmu_canonical_${++eventNo}`,
    versionIdFactory: () => "ver_omgmu_canonical_1",
  });

  assert.equal(prepared.context.university, "omgmu");
  assert.equal(prepared.context.program, "medicine-international");
  assert.equal(prepared.context.course, 4);
  assert.equal(prepared.context.groupCode, "485");
  assert.equal(prepared.context.groupId, "omgmu:medicine-international:4:485");
  assert.equal(prepared.inputQa.publishable, true);
  assert.equal(prepared.outputQa.publishable, true);
  assert.equal(prepared.diff.counts.added, 4);
  assert.equal(prepared.batch.events.length, 4);
  assert.ok(prepared.batch.events.every((event) => event.system.event_id?.startsWith("evt_omgmu_canonical_")));
  assert.ok(prepared.batch.events.every((event) => event.timing.time_mode === "floating"));
  assert.ok(prepared.batch.events.every((event) => event.calendar.title));
  assert.match(prepared.ics, /DTSTART:20260406T110000/);
  assert.doesNotMatch(prepared.ics, /TZID=Asia\/Omsk/);
  assert.doesNotMatch(prepared.ics, /DTSTART[^\r\n]*\+06/);
});

test("keeps structural cycle type conservative instead of guessing practice", () => {
  const batch = buildOmgmuCanonicalBatch({
    metadata: {
      academicYear: "2025/2026",
      semester: "spring",
      facultyCode: "medicine-international",
      facultyName: "Лечебное дело для иностранных граждан",
      course: 5,
      group: "585",
      period: { start_date: "2026-04-06", end_date: "2026-08-07", week1_start_date: "2026-02-02" },
    },
    source: { fileName: "5.pdf", fileHash: sourceHash },
    series: [{
      discipline: "Госпитальная терапия, эндокринология",
      kind: "cycle",
      startTime: "10:40",
      endTime: "13:50",
      dates: ["2026-07-24"],
      ruleIds: ["O44", "O70"],
    }],
  });

  assert.equal(batch.events[0].lesson.type.raw, "цикл");
  assert.equal(batch.events[0].lesson.type.code, "unknown");
});
