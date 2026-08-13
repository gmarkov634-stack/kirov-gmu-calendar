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
  assert.equal(context.academicYear, "2026/2027");
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

test("schedule context canonicalizes short academic year notation", () => {
  const context = scheduleContext({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    group: { id: "kgmu:pediatrics:1:132", code: "132" },
    academicYear: "2026/27",
    semester: 1,
  });
  assert.equal(context.academicYear, "2026/2027");
});

test("short and full academic year notation produce the same storage key", () => {
  const base = {
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    group: { id: "kgmu:pediatrics:1:132", code: "132" },
    semester: 1,
  };
  assert.equal(
    scheduleStorageKey({ ...base, academicYear: "2026/27" }),
    scheduleStorageKey({ ...base, academicYear: "2026/2027" }),
  );
});
