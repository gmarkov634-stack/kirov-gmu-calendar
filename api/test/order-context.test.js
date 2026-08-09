import assert from "node:assert/strict";
import test from "node:test";
import { legacyCompatibleContext, scheduleContext } from "../src/order-context.js";

test("legacy KГМУ schedule receives compatible defaults", () => {
  const context = scheduleContext({
    faculty: "pediatrics",
    course: 1,
    group: "132",
    academicYear: "2025-2026",
    semester: 2,
  });
  assert.equal(context.university, "kgmu");
  assert.equal(context.program, "pediatrics");
  assert.equal(context.groupCode, "132");
  assert.equal(context.groupId, "kgmu:pediatrics:1:132");
  assert.equal(context.timezone, "Europe/Moscow");
});

test("ОмГМУ normalized schedule preserves stream and arbitrary group code", () => {
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
    academicYear: "2026-2027",
    semester: 1,
    timezone: "Asia/Omsk",
  });
  assert.equal(context.university, "omgmu");
  assert.equal(context.stream, "2");
  assert.equal(context.groupCode, "Л-402А");
  assert.equal(context.groupId, "omgmu:medicine:4:stream-2:Л-402А");
  assert.equal(context.timezone, "Asia/Omsk");
});

test("legacy order remains readable through group string", () => {
  const record = legacyCompatibleContext({
    orderId: "o".repeat(32),
    faculty: "pediatrics",
    course: 1,
    group: "132",
  });
  assert.equal(record.group, "132");
  assert.equal(record.groupCode, "132");
  assert.equal(record.university, "kgmu");
});
