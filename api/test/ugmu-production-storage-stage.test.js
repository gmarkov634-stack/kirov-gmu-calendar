import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  catalogContextAllowed,
  universityCatalogEnabled,
  universitySalesEnabled,
  universityTrialsEnabled,
} from "../src/university-commerce-policy.mjs";
import { checkUgmuPublicBoundary } from "../tools/ugmu-production-storage-stage.mjs";

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

test("staging tool is pinned to step-22 manifest and contains rollback primitives without canonical/public publication paths", async () => {
  const source = await fs.readFile(new URL("../tools/ugmu-production-storage-stage.mjs", import.meta.url), "utf8");
  assert.match(source, /2d8103b1c0a873c8cd52cc569426338342f2671ce0d740db6f3f0482590262e5/);
  assert.match(source, /PRODUCTION_STORAGE_STAGE_ALLOWED/);
  assert.match(source, /DeleteObjectCommand/);
  assert.match(source, /rollbackTouched/);
  assert.match(source, /ugmu-preactivation-absence-marker/);
  assert.doesNotMatch(source, /schedule-publications\//);
  assert.doesNotMatch(source, /PutObjectCommand\([^\n]*calendar\.ics/);
});
