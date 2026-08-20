import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runUgmuSubscriptionRevokeE2e } from "../tools/ugmu-subscription-revoke-e2e.mjs";

test("UGMU revoke empties only the revoked paid calendar feed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-revoke-e2e-test-"));
  try {
    const report = await runUgmuSubscriptionRevokeE2e({ reportPath: path.join(directory, "report.json") });
    assert.equal(report.passed, true);
    assert.equal(report.mode, "isolated-subscription-revoke-e2e");
    assert.equal(report.http.unauthorizedRevokeStatus, 403);
    assert.equal(report.http.authorizedRevokeStatus, 200);
    assert.equal(report.http.revokedBeforeEvents, 2);
    assert.equal(report.http.revokedAfterEvents, 0);
    assert.equal(report.http.otherBeforeEvents, 2);
    assert.equal(report.http.otherAfterEvents, 2);
    assert.equal(report.http.revokedStoredStatus, "revoked");
    assert.equal(report.http.activeStoredStatus, "active");
    assert.ok(Object.values(report.checks).every(Boolean));
    assert.equal(report.launchAuthority.productionSalesAllowedByThisE2e, false);
    assert.equal(report.launchAuthority.productionPublicationAllowedByThisE2e, false);
    assert.equal(report.nextRequiredBoundary, "cross-university-historical-regression");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
