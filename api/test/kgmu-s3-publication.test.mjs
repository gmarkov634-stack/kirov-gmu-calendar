import assert from "node:assert/strict";
import test from "node:test";
import { buildKgmuPublicationPlan } from "../src/adapters/kgmu/publish.mjs";
import { buildKgmuS3WriteSet } from "../src/adapters/kgmu/s3-publication.mjs";

function targetSchedule(overrides = {}) {
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
    academicYear: "2026/2027",
    semester: 1,
    sources: [{
      type: "official-xlsx",
      url: "https://kirovgma.ru/official.xlsx",
      sha256: "a".repeat(64),
    }],
    events: [{
      id: "event-1",
      title: "Анатомия",
      start: "2026-09-01T08:00:00+03:00",
      end: "2026-09-01T09:30:00+03:00",
      location: "КГМУ",
      sourceType: "official-xlsx",
    }],
    qa: {
      passed: true,
      archiveReferenceOnly: false,
      commercialTargetPeriod: true,
    },
    publishable: true,
    ...overrides,
  };
}

function validPlan(schedule = targetSchedule()) {
  return buildKgmuPublicationPlan([schedule]);
}

test("KGMU S3 write set accepts only a revalidated target-period publication plan", () => {
  const writeSet = buildKgmuS3WriteSet(validPlan(), {
    academicYear: "2026/27",
    semester: 1,
  });

  assert.equal(writeSet.objects.length, 1);
  assert.equal(writeSet.objects[0].group, "132");
  assert.match(writeSet.objects[0].key, /^schedules\/kgmu\/pediatrics\/1\/2026-2027\/semester-1\//);
  assert.equal(writeSet.objects[0].sourceSha256, "a".repeat(64));
  assert.match(writeSet.objects[0].bodySha256, /^[a-f0-9]{64}$/);
});

test("KGMU S3 write set rejects the wrong commercial period", () => {
  assert.throws(
    () => buildKgmuS3WriteSet(validPlan(), { academicYear: "2026/2027", semester: 2 }),
    /publication-period-mismatch:132/,
  );
});

test("KGMU S3 write set rejects a publication key changed after dry run", () => {
  const plan = validPlan();
  plan.publishable[0].key = "schedules/kgmu/pediatrics/1/2026-2027/semester-1/tampered.json";
  assert.throws(
    () => buildKgmuS3WriteSet(plan, { academicYear: "2026/2027", semester: 1 }),
    /publication-key-mismatch:132/,
  );
});

test("KGMU S3 write set rejects a source hash changed after dry run", () => {
  const plan = validPlan();
  plan.publishable[0].sourceSha256 = "b".repeat(64);
  assert.throws(
    () => buildKgmuS3WriteSet(plan, { academicYear: "2026/2027", semester: 1 }),
    /publication-source-hash-mismatch:132/,
  );
});

test("archive KGMU schedules cannot become S3 write objects", () => {
  const archive = targetSchedule({
    academicYear: "2025/2026",
    semester: 2,
    qa: {
      passed: true,
      archiveReferenceOnly: true,
      commercialTargetPeriod: false,
    },
    publishable: false,
  });
  const plan = buildKgmuPublicationPlan([archive]);
  const writeSet = buildKgmuS3WriteSet(plan, { academicYear: "2026/2027", semester: 1 });
  assert.equal(writeSet.objects.length, 0);
  assert.equal(writeSet.blockedCount, 1);
});
