import assert from "node:assert/strict";
import test from "node:test";
import { buildKgmuPublicationPlan, publicationDecision, scheduleObjectKey } from "../src/adapters/kgmu/publish.mjs";

const hash = "a".repeat(64);

function schedule(overrides = {}) {
  return {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "pediatrics",
    course: 1,
    group: {
      id: "kgmu:pediatrics:1:132",
      code: "132",
      displayName: "Группа 132",
    },
    timezone: "Europe/Moscow",
    academicYear: "2026/27",
    semester: 1,
    sources: [{
      type: "official-xlsx",
      url: "https://example.test/weekly.xlsx",
      sha256: hash,
    }],
    events: [{
      id: "event-1",
      title: "Анатомия",
      start: "2026-09-01T05:00:00.000Z",
      end: "2026-09-01T06:30:00.000Z",
      location: "КГМУ",
      sourceType: "official-xlsx",
    }],
    qa: {
      archiveReferenceOnly: false,
      commercialTargetPeriod: true,
      passed: true,
      blockingIssueCount: 0,
    },
    publishable: true,
    ...overrides,
  };
}

test("builds the versioned KGMU storage key from a normalized schedule", () => {
  assert.equal(
    scheduleObjectKey(schedule()),
    "schedules/kgmu/pediatrics/1/2026-2027/semester-1/kgmu%3Apediatrics%3A1%3A132.json",
  );
});

test("archive/reference schedules never receive a publication key", () => {
  const archived = schedule({
    academicYear: "2025/2026",
    semester: 2,
    qa: {
      archiveReferenceOnly: true,
      commercialTargetPeriod: false,
      passed: true,
      blockingIssueCount: 0,
    },
    publishable: false,
  });
  assert.deepEqual(publicationDecision(archived), { publish: false, reason: "archive-reference" });
  const plan = buildKgmuPublicationPlan([archived]);
  assert.equal(plan.publishable.length, 0);
  assert.equal("key" in plan.blocked[0], false);
});

test("publishes only a QA-passed target schedule with official source hash", () => {
  const decision = publicationDecision(schedule());
  assert.equal(decision.publish, true);
  assert.equal(decision.reason, "verified-dry-run");
  assert.equal(decision.sourceSha256, hash);
});

test("blocks a target group with parser QA issues", () => {
  assert.deepEqual(
    publicationDecision(schedule({
      qa: {
        archiveReferenceOnly: false,
        commercialTargetPeriod: true,
        passed: false,
        blockingIssueCount: 1,
      },
      publishable: false,
    })),
    { publish: false, reason: "parser-qa-blocked" },
  );
});

test("blocks schedules without the hash of the exact official XLSX", () => {
  assert.deepEqual(
    publicationDecision(schedule({
      sources: [{ type: "official-xlsx", url: "https://example.test/weekly.xlsx", sha256: null }],
    })),
    { publish: false, reason: "missing-official-source-hash" },
  );
});

test("blocks schedules containing non-official generated events", () => {
  assert.deepEqual(
    publicationDecision(schedule({
      events: [{
        id: "manual",
        title: "Анатомия",
        start: "2026-09-01T05:00:00.000Z",
        end: "2026-09-01T06:30:00.000Z",
        sourceType: "manual",
      }],
    })),
    { publish: false, reason: "untrusted-events" },
  );
});

test("publication planning does not reinterpret a parser-resolved date-specific time", () => {
  const normalized = schedule({
    events: [
      {
        id: "ordinary",
        title: "Гистология",
        start: "2026-05-25T10:45:00.000Z",
        end: "2026-05-25T12:15:00.000Z",
        sourceType: "official-xlsx",
      },
      {
        id: "override",
        title: "Гистология",
        start: "2026-06-01T10:45:00.000Z",
        end: "2026-06-01T13:55:00.000Z",
        sourceType: "official-xlsx",
      },
    ],
  });
  const plan = buildKgmuPublicationPlan([normalized]);
  assert.equal(plan.publishable.length, 1);
  assert.equal(plan.publishable[0].schedule.events[0].end, "2026-05-25T12:15:00.000Z");
  assert.equal(plan.publishable[0].schedule.events[1].end, "2026-06-01T13:55:00.000Z");
});
