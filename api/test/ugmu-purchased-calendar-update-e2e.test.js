import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runUgmuPurchasedCalendarUpdateE2e } from "../tools/ugmu-purchased-calendar-update-e2e.mjs";

test("UGMU paid subscription serves an updated schedule through the same URL without repurchase", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-purchased-update-test-"));
  try {
    const report = await runUgmuPurchasedCalendarUpdateE2e({ reportPath: path.join(directory, "report.json") });
    assert.equal(report.passed, true);
    assert.equal(report.payment.paymentsCreated, 1);
    assert.equal(report.payment.externalRequests, 0);
    assert.deepEqual(report.payment.providerCalls.map((item) => item.method), ["POST", "GET"]);
    assert.equal(report.update.checkoutStatus, 201);
    assert.equal(report.update.webhookStatus, 200);
    assert.equal(report.update.initialIcsStatus, 200);
    assert.equal(report.update.updatedIcsStatus, 200);
    assert.equal(report.update.subscriptionUrlStable, true);
    assert.equal(report.update.targetInitialSequence, 0);
    assert.equal(report.update.targetUpdatedSequence, 1);
    assert.equal(report.update.unchangedInitialSequence, 0);
    assert.equal(report.update.unchangedUpdatedSequence, 0);
    assert.equal(report.update.initialEventCount, report.update.updatedEventCount);
    assert.equal(report.update.publicScheduleStatusAfterUpdate, 404);
    assert.ok(Object.values(report.checks).every(Boolean));
    assert.equal(report.launchAuthority.productionSalesAllowedByThisE2e, false);
    assert.equal(report.launchAuthority.productionPublicationAllowedByThisE2e, false);
    assert.equal(report.launchAuthority.nextRequiredBoundary, "subscription-revoke-e2e");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
