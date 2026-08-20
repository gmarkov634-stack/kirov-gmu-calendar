import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { scheduleStorageKey } from "../src/order-context.js";
import { MultiUniversityStore } from "../src/university-store.js";
import { getUniversityConfig } from "../src/universities/registry.mjs";

const SOURCE_SHA = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const GROUP_ID = "ugmu:medicine:1:stream-1:ОЛД 101";
const TOKEN_REVOKED = "A".repeat(43);
const TOKEN_ACTIVE = "B".repeat(43);
const ADMIN_TOKEN = "ugmu-revoke-e2e-admin-token-0123456789abcdef";
const EXPIRES_AT = "2027-01-09T10:20:00.000Z";

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function event({ id, date, start, end, title, location }) {
  const stamp = "2026-08-20T18:00:00.000Z";
  return {
    system: {
      event_id: id,
      schedule_version_id: "ver_ugmu_old101_revoke_e2e",
      revision: 1,
      created_at: stamp,
      updated_at: stamp,
    },
    audience: { stream: "1" },
    timing: { date, start_time: start, end_time: end, all_day: false, time_mode: "floating" },
    calendar: { title, location, description: "Проверенное расписание УГМУ" },
  };
}

function canonicalSchedule() {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "ugmu",
      faculty_code: "medicine",
      course: 1,
      stream: "1",
      group: "ОЛД 101",
      group_id: GROUP_ID,
      group_display_name: "Группа ОЛД 101",
      academic_year: "2026/2027",
      semester: "autumn",
      timezone: "Asia/Yekaterinburg",
      schedule_version_id: "ver_ugmu_old101_revoke_e2e",
      version_created_at: "2026-08-20T18:00:00.000Z",
      content_fingerprint: `sha256:${SOURCE_SHA}`,
      period: { start_date: "2026-09-01", end_date: "2027-01-10" },
      source_sha256: SOURCE_SHA,
    },
    events: [
      event({
        id: "evt_ugmu_old101_0001",
        date: "2026-09-01",
        start: "08:50",
        end: "10:20",
        title: "ЛЕКЦ. ХИМИЯ",
        location: "Онлайн",
      }),
      event({
        id: "evt_ugmu_old101_last",
        date: "2027-01-09",
        start: "13:50",
        end: "15:20",
        title: "История России",
        location: "Н.Онуфриева, 20а",
      }),
    ],
  };
}

function subscription({ orderId, paymentId }) {
  return {
    version: 2,
    status: "active",
    entitlement: "paid",
    university: "ugmu",
    universityName: "УГМУ",
    program: "medicine",
    course: 1,
    stream: "1",
    groupCode: "ОЛД 101",
    groupId: GROUP_ID,
    groupDisplayName: "Группа ОЛД 101",
    timezone: "Asia/Yekaterinburg",
    academicYear: "2026/2027",
    semester: 1,
    plan: "semester",
    expiresAt: EXPIRES_AT,
    orderId,
    paymentId,
    createdAt: "2026-08-20T18:00:00.000Z",
  };
}

function countEvents(ics) {
  return (String(ics).match(/BEGIN:VEVENT/g) || []).length;
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function writeSchedule(dataDir, schedule) {
  const filename = path.join(dataDir, scheduleStorageKey(schedule));
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, `${JSON.stringify(schedule)}\n`);
}

export async function runUgmuSubscriptionRevokeE2e({ reportPath } = {}) {
  const startedAt = new Date().toISOString();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-revoke-e2e-"));
  const schedule = canonicalSchedule();
  const runtime = loadConfig({
    DATA_DIR: dataDir,
    ADMIN_TOKEN: ADMIN_TOKEN,
    SUBSCRIPTION_SIGNING_SECRET: "ugmu-revoke-e2e-signing-secret-32-bytes-minimum",
  });
  const config = {
    ...runtime,
    adminToken: ADMIN_TOKEN,
    subscriptionSigningSecret: "ugmu-revoke-e2e-signing-secret-32-bytes-minimum",
  };
  const baseline = loadConfig({
    COMMERCIAL_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    TRIALS_ENABLED: "true",
    UGMU_SITE_URL: "https://must-not-open.example",
  });
  const university = getUniversityConfig("ugmu");
  const revokedHash = tokenHash(TOKEN_REVOKED);
  const activeHash = tokenHash(TOKEN_ACTIVE);

  try {
    await writeSchedule(dataDir, schedule);
    const store = new MultiUniversityStore(config);
    await store.putSubscription(TOKEN_REVOKED, subscription({
      orderId: "ord_ugmu_revoke_e2e_00000000001",
      paymentId: "pay_ugmu_revoke_e2e_001",
    }));
    await store.putSubscription(TOKEN_ACTIVE, subscription({
      orderId: "ord_ugmu_revoke_e2e_00000000002",
      paymentId: "pay_ugmu_revoke_e2e_002",
    }));

    const result = await withServer(createHandler({ store, config, payments: null }), async (origin) => {
      const revokedUrl = `${origin}/api/v1/subscriptions/${TOKEN_REVOKED}/calendar.ics`;
      const activeUrl = `${origin}/api/v1/subscriptions/${TOKEN_ACTIVE}/calendar.ics`;

      const revokedBeforeResponse = await fetch(revokedUrl);
      assert.equal(revokedBeforeResponse.status, 200);
      const revokedBefore = await revokedBeforeResponse.text();
      assert.equal(countEvents(revokedBefore), 2);
      assert.ok(revokedBefore.includes("UID:evt_ugmu_old101_0001@ugmu-calendar"));

      const activeBeforeResponse = await fetch(activeUrl);
      assert.equal(activeBeforeResponse.status, 200);
      const activeBefore = await activeBeforeResponse.text();
      assert.equal(countEvents(activeBefore), 2);
      assert.ok(activeBefore.includes("UID:evt_ugmu_old101_0001@ugmu-calendar"));

      const unauthorizedResponse = await fetch(`${origin}/api/v1/admin/subscriptions/${revokedHash}/revoke`, {
        method: "POST",
        headers: { "x-admin-token": "wrong-admin-token" },
      });
      assert.equal(unauthorizedResponse.status, 403);
      assert.deepEqual(await unauthorizedResponse.json(), { error: "admin_forbidden" });
      assert.equal((await store.getSubscription(TOKEN_REVOKED))?.status, "active");

      const revokeResponse = await fetch(`${origin}/api/v1/admin/subscriptions/${revokedHash}/revoke`, {
        method: "POST",
        headers: { "x-admin-token": ADMIN_TOKEN },
      });
      assert.equal(revokeResponse.status, 200);
      assert.deepEqual(await revokeResponse.json(), { status: "revoked", groupCode: "ОЛД 101" });

      const revokedStored = await store.getSubscription(TOKEN_REVOKED);
      const activeStored = await store.getSubscription(TOKEN_ACTIVE);
      assert.equal(revokedStored?.status, "revoked");
      assert.ok(Number.isFinite(Date.parse(revokedStored?.revokedAt || "")));
      assert.equal(activeStored?.status, "active");
      assert.equal(activeStored?.revokedAt, undefined);

      const revokedAfterResponse = await fetch(revokedUrl);
      assert.equal(revokedAfterResponse.status, 200);
      assert.match(revokedAfterResponse.headers.get("content-type") || "", /^text\/calendar/);
      const revokedAfter = await revokedAfterResponse.text();
      assert.ok(revokedAfter.includes("BEGIN:VCALENDAR"));
      assert.ok(revokedAfter.includes("END:VCALENDAR"));
      assert.equal(countEvents(revokedAfter), 0);
      assert.ok(!revokedAfter.includes("evt_ugmu_old101_0001@ugmu-calendar"));

      const activeAfterResponse = await fetch(activeUrl);
      assert.equal(activeAfterResponse.status, 200);
      const activeAfter = await activeAfterResponse.text();
      assert.equal(countEvents(activeAfter), 2);
      assert.ok(activeAfter.includes("UID:evt_ugmu_old101_0001@ugmu-calendar"));

      const adminListResponse = await fetch(`${origin}/api/v1/admin/subscriptions`, {
        headers: { "x-admin-token": ADMIN_TOKEN },
      });
      assert.equal(adminListResponse.status, 200);
      const adminList = await adminListResponse.json();
      const revokedRecord = adminList.subscriptions.find((item) => item.tokenHash === revokedHash);
      const activeRecord = adminList.subscriptions.find((item) => item.tokenHash === activeHash);
      assert.equal(revokedRecord?.status, "revoked");
      assert.equal(activeRecord?.status, "active");

      return {
        unauthorizedRevokeStatus: unauthorizedResponse.status,
        authorizedRevokeStatus: revokeResponse.status,
        revokedFeedStatus: revokedAfterResponse.status,
        activeFeedStatus: activeAfterResponse.status,
        revokedBeforeEvents: countEvents(revokedBefore),
        revokedAfterEvents: countEvents(revokedAfter),
        otherBeforeEvents: countEvents(activeBefore),
        otherAfterEvents: countEvents(activeAfter),
        revokedStoredStatus: revokedStored.status,
        activeStoredStatus: activeStored.status,
        revokedAt: revokedStored.revokedAt,
        adminListRevokedStatus: revokedRecord.status,
        adminListActiveStatus: activeRecord.status,
      };
    });

    assert.equal(baseline.universityAccess.ugmu.apiRoutingEnabled, true);
    assert.equal(baseline.universityAccess.ugmu.publicEndpointsEnabled, false);
    assert.equal(baseline.universityAccess.ugmu.checkoutEnabled, false);
    assert.equal(baseline.universityAccess.ugmu.trialsEnabled, false);
    assert.equal(baseline.universitySiteUrls.ugmu, "");
    assert.equal(university.active, false);

    const report = {
      version: 1,
      university: "ugmu",
      mode: "isolated-subscription-revoke-e2e",
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: true,
      scope: {
        program: "medicine",
        course: 1,
        stream: "1",
        group: "ОЛД 101",
        groupId: GROUP_ID,
        academicYear: "2026/2027",
        semester: 1,
        sourceSha256: SOURCE_SHA,
      },
      http: result,
      checks: {
        adminProtectionWorks: result.unauthorizedRevokeStatus === 403,
        revokeAccepted: result.authorizedRevokeStatus === 200,
        revokedSubscriptionPersisted: result.revokedStoredStatus === "revoked" && Number.isFinite(Date.parse(result.revokedAt)),
        oldFeedBecomesEmptyCalendar: result.revokedFeedStatus === 200 && result.revokedBeforeEvents === 2 && result.revokedAfterEvents === 0,
        siblingSubscriptionUnaffected: result.activeFeedStatus === 200 && result.otherBeforeEvents === 2 && result.otherAfterEvents === 2 && result.activeStoredStatus === "active",
        adminListReflectsIsolation: result.adminListRevokedStatus === "revoked" && result.adminListActiveStatus === "active",
        productionRegistryInactive: university.active === false,
        productionCheckoutFailClosed: baseline.universityAccess.ugmu.checkoutEnabled === false,
        productionPublicFailClosed: baseline.universityAccess.ugmu.publicEndpointsEnabled === false,
        productionTrialsFailClosed: baseline.universityAccess.ugmu.trialsEnabled === false,
        productionPaidRedirectEmpty: baseline.universitySiteUrls.ugmu === "",
      },
      launchAuthority: {
        productionSalesAllowedByThisE2e: false,
        productionPublicationAllowedByThisE2e: false,
      },
      nextRequiredBoundary: "cross-university-historical-regression",
    };
    assert.ok(Object.values(report.checks).every(Boolean));

    const output = path.resolve(
      process.cwd(),
      reportPath || process.env.UGMU_REVOKE_E2E_REPORT || "data/regression/ugmu-subscription-revoke-e2e-report.json",
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log("UGMU subscription revoke E2E: PASS");
    console.log(`Revoked feed VEVENT: ${result.revokedBeforeEvents} -> ${result.revokedAfterEvents}`);
    console.log(`Sibling feed VEVENT: ${result.otherBeforeEvents} -> ${result.otherAfterEvents}`);
    console.log(`Unauthorized/admin revoke: ${result.unauthorizedRevokeStatus} -> ${result.authorizedRevokeStatus}`);
    console.log(`Report: ${output}`);
    return report;
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runUgmuSubscriptionRevokeE2e().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
