import test from "node:test";
import assert from "node:assert/strict";

import { buildUgmuPilotPublicationPackage } from "../src/adapters/ugmu/publication-package.mjs";

const RAW = {
  university: "ugmu",
  course: 1,
  stream: "1",
  academicYear: "2026/2027",
  semester: 1,
  group: { code: "ОЛД 101" },
  semesterPeriod: { start: "2026-09-01", end: "2027-01-10" },
  weekAnchors: { I: "2026-09-01", II: "2026-09-07" },
  sources: [{
    url: "https://usma.ru/wp-content/uploads/2026/08/1OLD.pdf",
    sha256: "a".repeat(64),
  }],
  sourceReview: { status: "semantic-reviewed-pilot", publicationAllowed: false },
  events: [
    {
      title: "Химия",
      sourceTitle: "Химия",
      start: "2026-09-01T08:50:00+05:00",
      end: "2026-09-01T10:20:00+05:00",
      location: "Онлайн",
      locationNote: "",
      department: "Общей химии",
      lessonType: "lecture",
      weekRule: "weekly",
    },
    {
      title: "Химия",
      sourceTitle: "Химия",
      start: "2026-09-01T13:50:00+05:00",
      end: "2026-09-01T15:20:00+05:00",
      location: "Декабристов, 32",
      locationNote: "",
      department: "Общей химии",
      lessonType: "class",
      weekRule: "weekly",
    },
  ],
};

test("UGMU OLD 101 package creates a versioned schedule, ICS and fail-closed pointers", () => {
  const pkg = buildUgmuPilotPublicationPackage(RAW, {
    now: "2026-08-20T17:15:00.000Z",
    versionId: "ver_test_ugmu_old101",
  });

  assert.equal(pkg.batch.schedule.schedule_version_id, "ver_test_ugmu_old101");
  assert.equal(pkg.batch.events.length, 2);
  assert.match(pkg.ics, /X-WR-CALNAME:УГМУ · Группа ОЛД 101/);
  assert.match(pkg.ics, /UID:evt_ugmu_old101_0001@ugmu-calendar/);
  assert.match(pkg.ics, /SEQUENCE:0/);

  assert.equal(pkg.current.scheduleVersionId, pkg.batch.schedule.schedule_version_id);
  assert.equal(pkg.current.eventCount, 2);
  assert.equal(pkg.current.state, "qa-approved-fail-closed");
  assert.equal(pkg.current.publicationAllowed, false);
  assert.equal(pkg.current.active, false);
  assert.equal(pkg.current.catalogVisible, false);
  assert.equal(pkg.current.checkoutEnabled, false);
  assert.equal(pkg.current.salesEnabled, false);
  assert.equal(pkg.current.files.schedule, "versions/ver_test_ugmu_old101.json");
  assert.equal(pkg.current.files.ics, "calendar.ics");
  assert.match(pkg.current.hashes.icsSha256, /^[a-f0-9]{64}$/);

  assert.equal(pkg.catalog.mode, "internal-fail-closed");
  assert.equal(pkg.catalog.groupCount, 1);
  assert.equal(pkg.catalog.groups[0].code, "ОЛД 101");
  assert.equal(pkg.catalog.groups[0].qaStatus, "approved");
  assert.equal(pkg.catalog.groups[0].calendarReady, true);
  assert.equal(pkg.catalog.groups[0].active, false);
  assert.equal(pkg.catalog.groups[0].public, false);
  assert.equal(pkg.catalog.groups[0].checkoutEnabled, false);
  assert.equal(pkg.catalog.groups[0].salesEnabled, false);

  assert.equal(pkg.report.inputQa, true);
  assert.equal(pkg.report.outputQa, true);
  assert.equal(pkg.report.currentPointerValid, true);
  assert.equal(pkg.report.catalogPointerValid, true);
  assert.equal(pkg.report.failClosed, true);
  assert.equal(pkg.report.publicationAllowed, false);
});

test("UGMU publication package rejects a non-OLD101 pilot", () => {
  assert.throws(
    () => buildUgmuPilotPublicationPackage({ ...RAW, group: { code: "ОЛД 102" } }),
    /fail-closed to ОЛД 101/,
  );
});
