import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  catalogContextAllowed,
  universityCatalogEnabled,
  universitySalesEnabled,
  universityTrialsEnabled,
} from "../src/university-commerce-policy.mjs";
import {
  checkUgmuPublicBoundary,
  validateApprovedUgmuScheduleObject,
} from "../tools/ugmu-production-storage-stage.mjs";

function response(status, body) {
  return {
    status,
    async json() { return body; },
  };
}

function closedBoundaryFetch({ catalogStatus = 404, catalogError = "catalog_not_available" } = {}) {
  return async (url) => {
    const value = String(url);
    if (value.endsWith("/health")) return response(200, { status: "ok", service: "medical-calendar-api" });
    if (value.endsWith("/api/v2/meta")) return response(200, { sales: "closed", trials: "closed", paymentMode: "test" });
    if (value.includes("/api/v2/catalog/ugmu/programs")) return response(catalogStatus, catalogStatus === 404 ? { error: catalogError } : { university: "ugmu", programs: [] });
    if (value.includes("/api/v2/schedules/ugmu/")) return response(404, { error: "schedule_not_published" });
    if (value.endsWith("/api/v2/payments")) return response(409, { error: "sales_not_open" });
    throw new Error(`Unexpected URL ${value}`);
  };
}

function approvedScheduleFixture() {
  const versionId = "ver_ugmu_old101_preactivation_34612248bba2";
  const event = (id) => ({
    system: { event_id: id, schedule_version_id: versionId },
    university: { code: "ugmu", name: "Уральский государственный медицинский университет" },
    academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "medicine", course: 1 },
    audience: { group: "ОЛД 101", scope: "whole_group", stream: "1" },
    source: { file_hash: "sha256:34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8" },
  });
  return {
    item: {
      group: "ОЛД 101",
      groupId: "ugmu:medicine:1:stream-1:ОЛД 101",
      versionId,
      eventCount: 2,
      uniqueEventIds: 2,
    },
    parsed: {
      schema_version: "1.0",
      schedule: {
        university_code: "ugmu",
        academic_year: "2026/2027",
        semester: "autumn",
        faculty_code: "medicine",
        course: 1,
        group: "ОЛД 101",
        schedule_version_id: versionId,
      },
      events: [event("evt_ugmu_old101_0001"), event("evt_ugmu_old101_0002")],
    },
  };
}

test("UGMU commerce policy stays catalog/sales/trials closed during production storage staging", () => {
  assert.equal(universityCatalogEnabled("ugmu"), false);
  assert.equal(universitySalesEnabled("ugmu"), false);
  assert.equal(universityTrialsEnabled("ugmu"), false);
  assert.equal(catalogContextAllowed({ university: "ugmu", program: "medicine", course: 1 }), false);
});

test("production boundary accepts only a closed UGMU catalog, public schedule and checkout", async () => {
  const result = await checkUgmuPublicBoundary("https://production.example", closedBoundaryFetch());
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks, {
    health: true,
    salesClosed: true,
    trialsClosed: true,
    catalogClosed: true,
    publicScheduleClosed: true,
    checkoutClosed: true,
  });
});

test("production boundary fails if staged UGMU becomes visible in the public catalog", async () => {
  const result = await checkUgmuPublicBoundary(
    "https://production.example",
    closedBoundaryFetch({ catalogStatus: 200 }),
  );
  assert.equal(result.passed, false);
  assert.equal(result.checks.catalogClosed, false);
});

test("approved Step22 canonical object uses schedule.university_code and per-event source identity", () => {
  const { parsed, item } = approvedScheduleFixture();
  const result = validateApprovedUgmuScheduleObject(parsed, item);
  assert.equal(result.passed, true);
  assert.equal(Object.values(result.checks).every(Boolean), true);
});

test("approved-object validation fails closed on university, group, version or source drift", () => {
  for (const mutate of [
    (parsed) => { parsed.schedule.university_code = "kgmu"; },
    (parsed) => { parsed.schedule.group = "ОЛД 102"; },
    (parsed) => { parsed.schedule.schedule_version_id = "wrong-version"; },
    (parsed) => { parsed.events[0].source.file_hash = "sha256:wrong"; },
  ]) {
    const { parsed, item } = approvedScheduleFixture();
    mutate(parsed);
    assert.equal(validateApprovedUgmuScheduleObject(parsed, item).passed, false);
  }
});

test("staging tool is pinned to step-22 manifest and contains rollback primitives without canonical/public publication paths", async () => {
  const source = await fs.readFile(new URL("../tools/ugmu-production-storage-stage.mjs", import.meta.url), "utf8");
  assert.match(source, /2d8103b1c0a873c8cd52cc569426338342f2671ce0d740db6f3f0482590262e5/);
  assert.match(source, /PRODUCTION_STORAGE_STAGE_ALLOWED/);
  assert.match(source, /DeleteObjectCommand/);
  assert.match(source, /rollbackTouched/);
  assert.match(source, /ugmu-preactivation-absence-marker/);
  assert.match(source, /schedule\?\.university_code === "ugmu"/);
  assert.match(source, /event\?\.source\?\.file_hash === EXPECTED_SOURCE_FILE_HASH/);
  assert.doesNotMatch(source, /schedule-publications\//);
  assert.doesNotMatch(source, /PutObjectCommand\([^\n]*calendar\.ics/);
});
