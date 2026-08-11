import assert from "node:assert/strict";
import test from "node:test";
import { validateKgmuVerifiedImport } from "../src/adapters/kgmu/verified-import.mjs";
import { publicationDecision } from "../src/adapters/kgmu/publish.mjs";

const sourceHash = "a".repeat(64);
const sourceUrl = "https://kirovgma.ru/schedule/1_ped.xlsx";

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
    sources: [{ type: "official-xlsx", url: sourceUrl, sha256: sourceHash }],
    events: [{
      id: "e1",
      title: "Гистология",
      start: "2026-09-01T13:45:00+03:00",
      end: "2026-09-01T15:15:00+03:00",
      location: "",
      sourceType: "official-xlsx",
    }],
    ...overrides,
  };
}

function bundle(overrides = {}) {
  return {
    version: 1,
    university: "kgmu",
    academicYear: "2026/2027",
    semester: 1,
    review: {
      status: "approved",
      approvedAt: "2026-08-11T18:00:00+03:00",
      method: "semi-automatic",
    },
    sourceFiles: [{ filename: "1_ped.xlsx", url: sourceUrl, sha256: sourceHash }],
    schedules: [schedule()],
    ...overrides,
  };
}

const target = { academicYear: "2026/27", semester: 1 };

test("accepts an approved semi-automatic bundle and hands it to the publication gate", () => {
  const result = validateKgmuVerifiedImport(bundle(), target);
  assert.equal(result.scheduleCount, 1);
  assert.equal(result.schedules[0].academicYear, "2026/2027");
  assert.equal(result.schedules[0].qa.verificationSource, "verified-import");
  assert.equal(result.schedules[0].qa.verifiedSourceFile, "1_ped.xlsx");
  const decision = publicationDecision(result.schedules[0]);
  assert.equal(decision.publish, true);
  assert.match(decision.key, /2026-2027\/semester-1/);
});

test("does not accept an unapproved handoff", () => {
  assert.throws(
    () => validateKgmuVerifiedImport(bundle({ review: { status: "pending", approvedAt: "2026-08-11T18:00:00+03:00" } }), target),
    /verified-import-not-approved/,
  );
});

test("does not accept an archive bundle for the 2026\/27 offer", () => {
  assert.throws(
    () => validateKgmuVerifiedImport(bundle({ academicYear: "2025/2026", semester: 2 }), target),
    /verified-import-bundle-period-mismatch/,
  );
});

test("requires the exact official XLSX URL and SHA-256 from the source registry", () => {
  const bad = bundle({ schedules: [schedule({ sources: [{ type: "official-xlsx", url: sourceUrl, sha256: "b".repeat(64) }] })] });
  assert.throws(() => validateKgmuVerifiedImport(bad, target), /verified-import-source-not-registered/);
});

test("rejects a non-official source host", () => {
  const evilUrl = "https://example.com/1_ped.xlsx";
  const bad = bundle({
    sourceFiles: [{ filename: "1_ped.xlsx", url: evilUrl, sha256: sourceHash }],
    schedules: [schedule({ sources: [{ type: "official-xlsx", url: evilUrl, sha256: sourceHash }] })],
  });
  assert.throws(() => validateKgmuVerifiedImport(bad, target), /verified-import-source-not-official/);
});

test("rejects invalid or duplicate events", () => {
  const first = schedule().events[0];
  const bad = bundle({ schedules: [schedule({ events: [first, { ...first }] })] });
  assert.throws(() => validateKgmuVerifiedImport(bad, target), /verified-import-duplicate-event-id/);
});
