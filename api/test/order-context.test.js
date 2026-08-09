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
