import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runUgmuPaymentE2e } from "../tools/ugmu-payment-e2e.mjs";

test("UGMU payment E2E creates and fulfills a protected paid subscription without external network", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-payment-e2e-test-"));
  try {
    const report = await runUgmuPaymentE2e({ reportPath: path.join(directory, "report.json") });
    assert.equal(report.passed, true);
    assert.equal(report.payment.externalRequests, 0);
    assert.deepEqual(report.payment.providerCalls.map((item) => item.method), ["POST", "GET"]);
    assert.equal(report.http.checkoutStatus, 201);
    assert.equal(report.http.webhookStatus, 200);
    assert.equal(report.http.orderStatus, "succeeded");
    assert.equal(report.http.icsStatus, 200);
    assert.equal(report.http.publicScheduleStatus, 404);
    assert.equal(report.http.unauthorizedOrderStatus, 403);
    assert.equal(report.http.expiresAt, "2027-01-09T10:20:00.000Z");
    assert.ok(Object.values(report.checks).every(Boolean));
    assert.equal(report.launchAuthority.productionSalesAllowedByThisE2e, false);
    assert.equal(report.launchAuthority.productionPublicationAllowedByThisE2e, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
