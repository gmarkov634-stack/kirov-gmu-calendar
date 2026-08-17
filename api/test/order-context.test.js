import assert from "node:assert/strict";
import test from "node:test";
import { scheduleContext, scheduleStorageKey } from "../src/order-context.js";

test("builds ОмГМУ context with stream and arbitrary group code", () => {
  const context = scheduleContext({
    university: "omgmu",
    program: "medicine",
    course: 4,
    stream: "2",
    group: {
      id: "omgmu:medicine:4:stream-2:Л-402А",
      code: "Л-402А",
      displayName: "Группа Л-402А",
    },
    timezone: "Asia/Omsk",
    academicYear: "2026-2027",
    semester: 1,
  });
  assert.equal(context.university, "omgmu");
  assert.equal(context.groupCode, "Л-402А");
  assert.equal(context.stream, "2");
  assert.equal(context.timezone, "Asia/Omsk");
});

test("creates a university-scoped storage key", () => {
  const key = scheduleStorageKey({
    university: "pgmu",
    program: "pediatrics",
    course: 4,
    groupCode: "П-41",
  });
  assert.match(key, /^schedules\/pgmu\/pediatrics\/4\//);
  assert.match(key, /pgmu%3Apediatrics%3A4%3A/);
});

test("reads publication context from canonical schedule-batch v1", () => {
  const batch = {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "pediatrics",
      course: 4,
      group: "401",
    },
    events: [],
  };
  const context = scheduleContext(batch);
  assert.equal(context.university, "kgmu");
  assert.equal(context.program, "pediatrics");
  assert.equal(context.course, 4);
  assert.equal(context.groupCode, "401");
  assert.equal(context.groupId, "kgmu:pediatrics:4:401");
  assert.equal(context.academicYear, "2026/2027");
  assert.equal(context.semester, 1);
  assert.equal(context.timezone, "Europe/Moscow");
  assert.match(scheduleStorageKey(batch), /2026-2027\/semester-1\/kgmu%3Apediatrics%3A4%3A401\.json$/);
});

test("canonical publication context derives one uniform audience stream without changing the batch schema", () => {
  const batch = {
    schema_version: "1.0",
    schedule: {
      university_code: "omgmu",
      academic_year: "2025/2026",
      semester: "spring",
      faculty_code: "medicine-international",
      course: 2,
      group: "2101",
    },
    events: [
      { audience: { stream: "1" } },
      { audience: { stream: "1" } },
    ],
  };
  const context = scheduleContext(batch);
  assert.equal(context.stream, "1");
  assert.equal(context.groupId, "omgmu:medicine-international:2:stream-1:2101");
  assert.match(scheduleStorageKey(batch), /omgmu%3Amedicine-international%3A2%3Astream-1%3A2101\.json$/);
});

test("canonical publication context never guesses a stream from mixed event audiences", () => {
  const batch = {
    schema_version: "1.0",
    schedule: {
      university_code: "omgmu",
      academic_year: "2025/2026",
      semester: "spring",
      faculty_code: "medicine-international",
      course: 2,
      group: "2101",
    },
    events: [
      { audience: { stream: "1" } },
      { audience: { stream: "2" } },
    ],
  };
  const context = scheduleContext(batch);
  assert.equal(context.stream, null);
  assert.equal(context.groupId, "omgmu:medicine-international:2:2101");
});
