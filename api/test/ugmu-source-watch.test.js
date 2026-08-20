import assert from "node:assert/strict";
import test from "node:test";

import { buildUgmuSourceWatchReport, diffUgmuSourceVersions } from "../src/adapters/ugmu/watch.mjs";

const source = {
  program: "medicine",
  semester: "autumn",
  course: 1,
  stream: "1",
  part: "combined",
  label: "1 курс I поток",
  url: "https://usma.ru/wp-content/uploads/2026/08/1course.pdf",
};

const manifest = {
  university: "ugmu",
  program: "medicine",
  sourcePage: "https://usma.ru/example/",
  discoveredAt: "2026-08-20T12:00:00.000Z",
  sources: [source],
};

const downloaded = {
  university: "ugmu",
  program: "medicine",
  downloadedAt: "2026-08-20T12:01:00.000Z",
  files: [{
    ...source,
    sourceKey: "medicine/autumn/course-1/stream-1/combined",
    status: "downloaded",
    filename: "01_medicine_autumn_course-1_stream-1_combined.pdf",
    sha256: "a".repeat(64),
    bytes: 100,
  }],
};

const config = {
  university: "ugmu",
  program: "medicine",
  expectedAcademicYear: "2026/2027",
  expectedSemester: "autumn",
  targetCourses: [1, 2, 3, 4, 5, 6],
  semanticReviewRequired: true,
  autoPublish: false,
};

test("UGMU watch is fail-closed without a previous version baseline", () => {
  const report = buildUgmuSourceWatchReport(manifest, downloaded, config);
  assert.equal(report.status, "partial-captured-needs-semantic-review");
  assert.equal(report.candidateCount, 1);
  assert.deepEqual(report.availableCourses, [1]);
  assert.deepEqual(report.missingCourses, [2, 3, 4, 5, 6]);
  assert.equal(report.publicationAllowed, false);
  assert.equal(report.autoPublish, false);
  assert.equal(report.baselineAvailable, false);
});

test("UGMU version diff detects stable and changed PDF bytes on the same source key", () => {
  const current = downloaded.files;
  const same = diffUgmuSourceVersions({
    "medicine/autumn/course-1/stream-1/combined": "a".repeat(64),
  }, current);
  assert.equal(same[0].changeType, "unchanged");

  const changed = diffUgmuSourceVersions({
    "medicine/autumn/course-1/stream-1/combined": "b".repeat(64),
  }, current);
  assert.equal(changed[0].changeType, "changed");
  assert.equal(changed[0].previousSha256, "b".repeat(64));
  assert.equal(changed[0].sha256, "a".repeat(64));
});

test("UGMU watch rejects download failures and unresolved target metadata", () => {
  const brokenDownload = {
    ...downloaded,
    files: [{ ...source, status: "failed", sourceKey: "x", error: "HTTP 500" }],
  };
  const broken = buildUgmuSourceWatchReport(manifest, brokenDownload, config);
  assert.equal(broken.status, "needs-review");
  assert.equal(broken.failedCount, 1);
  assert.equal(broken.publicationAllowed, false);

  const unresolvedManifest = {
    ...manifest,
    sources: [{ ...source, course: null }],
  };
  const unresolved = buildUgmuSourceWatchReport(unresolvedManifest, downloaded, config);
  assert.equal(unresolved.status, "needs-review");
  assert.equal(unresolved.unresolvedCount, 1);
});
