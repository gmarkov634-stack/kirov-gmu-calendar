import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicationPlan, publicationDecision, scheduleObjectKey } from "../src/adapters/omgmu/publish.mjs";

function schedule(group, overrides = {}) {
  return {
    university: "omgmu",
    program: "medicine-international",
    course: group.length === 3 ? 3 : 2,
    group: { id: `omgmu:medicine-international:2:${group}`, code: group },
    academicYear: "2026/27",
    semester: 1,
    events: [{ id: "1", title: "Анатомия", start: "2026-09-06T08:00:00+06:00", end: "2026-09-06T10:00:00+06:00" }],
    ...overrides,
  };
}

test("builds an academic-year and semester scoped object key", () => {
  assert.equal(
    scheduleObjectKey(schedule("2101")),
    "schedules/omgmu/medicine-international/2/2026-2027/semester-1/omgmu%3Amedicine-international%3A2%3A2101.json",
  );
});

test("publishes an automatically verified group", () => {
  assert.equal(publicationDecision(schedule("2101")).publish, true);
});

test("blocks a schedule without an academic period", () => {
  assert.deepEqual(
    publicationDecision(schedule("2101", { academicYear: null, semester: null })),
    { publish: false, reason: "missing-publication-period" },
  );
});

test("blocks a pending manual-review group", () => {
  assert.deepEqual(publicationDecision(schedule("2113")), { publish: false, reason: "manual-review-pending" });
});

test("publishes only trusted approved manual events", () => {
  const approved = schedule("2113", {
    review: { status: "approved", sourceSha256: "abc" },
    events: [{ id: "m1", title: "Анатомия", start: "2026-09-06T08:00:00+06:00", end: "2026-09-06T10:00:00+06:00", sourceType: "manual-review" }],
  });
  assert.equal(publicationDecision(approved).publish, true);
});

test("reports publishable and blocked schedules with period-scoped storage keys", () => {
  const plan = buildPublicationPlan([schedule("2101"), schedule("2113")]);
  assert.equal(plan.publishable.length, 1);
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.blocked[0].reason, "manual-review-pending");
  assert.equal(
    plan.blocked[0].key,
    "schedules/omgmu/medicine-international/2/2026-2027/semester-1/omgmu%3Amedicine-international%3A2%3A2113.json",
  );
});
