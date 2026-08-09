import assert from "node:assert/strict";
import test from "node:test";
import { applyApprovedReview, sourceSha256, validateReview } from "../src/adapters/omgmu/manual-review.mjs";

const source = Buffer.from("official-pdf");
const hash = sourceSha256(source);
const review = {
  version: 1,
  group: "2108",
  sourceSha256: hash,
  status: "approved",
  reviewedBy: "reviewer@example.com",
  reviewedAt: "2026-08-09T19:00:00Z",
  events: [
    {
      title: "Анатомия",
      start: "2026-04-06T08:00:00+06:00",
      end: "2026-04-06T10:25:00+06:00",
      location: "Главный корпус"
    }
  ]
};

test("accepts an approved review for the current source", () => {
  assert.deepEqual(validateReview(review, { expectedGroup: "2108", sourceHash: hash }), { valid: true, errors: [] });
});

test("rejects review when the official PDF changed", () => {
  const result = validateReview(review, { expectedGroup: "2108", sourceHash: "different" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("source-changed"));
});

test("applies approved events without copying neighboring data", () => {
  const schedule = { group: { code: "2108" }, events: [] };
  const result = applyApprovedReview(schedule, review, { sourceHash: hash });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].sourceType, "manual-review");
  assert.equal(result.review.status, "approved");
});
