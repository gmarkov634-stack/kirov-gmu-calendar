import assert from "node:assert/strict";
import test from "node:test";
import { buildKgmuPublicationPlan } from "../src/adapters/kgmu/publish.mjs";

function archiveSchedule(groupCode) {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "pediatrics",
    course: 1,
    group: {
      id: `kgmu:pediatrics:1:${groupCode}`,
      code: groupCode,
      displayName: `Группа ${groupCode}`,
    },
    timezone: "Europe/Moscow",
    academicYear: "2025/2026",
    semester: 2,
    sources: [{
      type: "official-xlsx",
      sha256: "a".repeat(64),
      url: "https://kirovgma.ru/reference.xlsx",
    }],
    events: [{
      id: `archive-${groupCode}`,
      title: "Архивное занятие",
      start: "2026-05-25T10:45:00.000Z",
      end: "2026-05-25T12:15:00.000Z",
      sourceType: "official-xlsx",
    }],
    qa: {
      passed: true,
      archiveReferenceOnly: true,
      commercialTargetPeriod: false,
    },
    publishable: false,
  };
}

test("every archive KGMU schedule is blocked before a storage key can be issued", () => {
  const schedules = ["131", "132", "133"].map(archiveSchedule);
  const plan = buildKgmuPublicationPlan(schedules);

  assert.equal(plan.dryRun, true);
  assert.equal(plan.publishable.length, 0);
  assert.equal(plan.blocked.length, schedules.length);
  assert.ok(plan.blocked.every((entry) => entry.reason === "archive-reference"));
  assert.ok(plan.blocked.every((entry) => !("key" in entry)));
});
