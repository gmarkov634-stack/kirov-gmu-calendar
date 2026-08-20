import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { scheduleStorageKey } from "../src/order-context.js";
import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { versionSchedule } from "../src/schedule/versioning.js";
import { MultiUniversityStore } from "../src/university-store.js";
import { getUniversityConfig } from "../src/universities/registry.mjs";
import { YooKassaService } from "../src/yookassa.js";

const SOURCE_SHA = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const GROUP_ID = "ugmu:medicine:1:stream-1:ОЛД 101";
const PAYMENT_ID = "pay_ugmu_update_e2e_001";
const TARGET_EVENT_ID = "evt_ugmu_old101_0001";
const UNCHANGED_EVENT_ID = "evt_ugmu_old101_last";
const INITIAL_VERSION = "ver_ugmu_old101_update_e2e_v1";
const UPDATED_VERSION = "ver_ugmu_old101_update_e2e_v2";

function semanticEvent({ id, date, start, end, discipline, type, location }) {
  return {
    schema_version: "1.0",
    system: {
      event_id: id,
      schedule_version_id: null,
      fingerprint: null,
      revision: null,
      created_at: null,
      updated_at: null,
    },
    university: {
      code: "ugmu",
      name: "Уральский государственный медицинский университет",
    },
    academic: {
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "medicine",
      faculty_name: "Лечебное дело",
      course: 1,
    },
    audience: {
      group: "ОЛД 101",
      scope: "whole_group",
      subgroups: [],
      stream: "1",
    },
    timing: {
      date,
      start_time: start,
      end_time: end,
      all_day: false,
      time_mode: "floating",
    },
    lesson: {
      discipline: { raw: discipline, normalized: discipline },
      type: { raw: type === "lecture" ? "Л." : null, code: type },
      teachers: [],
      locations: location ? [{ raw: location }] : [],
      source_note: null,
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: "1ОЛД_1-поток_осень_26_замена_20_08.pdf",
      file_hash: `sha256:${SOURCE_SHA}`,
      sheet: null,
      references: [{ role: "lesson", range: `update-e2e:${id}` }],
      raw_text: discipline,
    },
    parse: { status: "ok", rule_ids: ["UGMU-PURCHASED-UPDATE-E2E"], warnings: [] },
    derived: {},
    calendar: { title: null, description: null, location: null },
  };
}

function incomingSchedule(targetLocation = "Онлайн") {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "ugmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "medicine",
      course: 1,
      stream: "1",
      group: "ОЛД 101",
      group_id: GROUP_ID,
      group_display_name: "Группа ОЛД 101",
      timezone: "Asia/Yekaterinburg",
      period: { start_date: "2026-09-01", end_date: "2027-01-10" },
      source_sha256: SOURCE_SHA,
    },
    events: [
      semanticEvent({
        id: TARGET_EVENT_ID,
        date: "2026-09-01",
        start: "08:50",
        end: "10:20",
        discipline: "Химия",
        type: "lecture",
        location: targetLocation,
      }),
      semanticEvent({
        id: UNCHANGED_EVENT_ID,
        date: "2027-01-09",
        start: "13:50",
        end: "15:20",
        discipline: "История России",
        type: "other",
        location: "Н.Онуфриева, 20а",
      }),
    ],
  };
}

function versioned(previous, incoming, { now, versionId }) {
  const result = versionSchedule(previous, incoming, {
    now,
    versionIdFactory: () => versionId,
  });
  return {
    batch: postprocessSchedule(result.batch, { includeServiceSignature: false }),
    diff: result.diff,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function e2eConfig(dataDir) {
  const runtime = loadConfig({
    DATA_DIR: dataDir,
    COMMERCIAL_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    OFFER_ACADEMIC_YEAR: "2026/2027",
    OFFER_SEMESTER: "1",
    OFFER_SEMESTER_PRICE: "299.00",
  });
  return {
    ...runtime,
    allowedOrigin: "https://update-e2e.example",
    allowedOrigins: ["https://update-e2e.example"],
    publicApiUrl: "https://api.update-e2e.example",
    publicBaseUrl: "https://site.update-e2e.example/ugmu/",
    universitySiteUrls: { ...runtime.universitySiteUrls, ugmu: "https://site.update-e2e.example/ugmu" },
    universityAccess: {
      ...runtime.universityAccess,
      ugmu: {
        apiRoutingEnabled: true,
        publicEndpointsEnabled: false,
        checkoutEnabled: true,
        trialsEnabled: false,
      },
    },
    yookassaShopId: "ugmu-update-e2e-shop",
    yookassaSecretKey: "ugmu-update-e2e-secret",
    yookassaTestMode: true,
    subscriptionSigningSecret: "ugmu-purchased-update-e2e-signing-secret-32-bytes-minimum",
    commercialSalesEnabled: true,
    enablePublicEndpoints: true,
    trialsEnabled: false,
  };
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
  return filename;
}

function unfoldIcs(value) {
  return String(value).replace(/\r\n[ \t]/g, "");
}

function eventBlocks(ics) {
  const unfolded = unfoldIcs(ics);
  return [...unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)\r\nEND:VEVENT/g)].map((match) => match[1]);
}

function blockForUid(ics, uid) {
  const blocks = eventBlocks(ics).filter((block) => block.includes(`UID:${uid}`));
  assert.equal(blocks.length, 1, `expected exactly one VEVENT for ${uid}`);
  return blocks[0];
}

function property(block, name) {
  const line = block.split("\r\n").find((item) => item.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1) : null;
}

export async function runUgmuPurchasedCalendarUpdateE2e({ reportPath } = {}) {
  const startedAt = new Date().toISOString();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-purchased-update-e2e-"));
  const baseline = loadConfig({
    COMMERCIAL_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    TRIALS_ENABLED: "true",
    UGMU_SITE_URL: "https://must-not-open.example",
  });
  const university = getUniversityConfig("ugmu");
  const initial = versioned(null, incomingSchedule(), {
    now: "2026-08-20T18:00:00.000Z",
    versionId: INITIAL_VERSION,
  });
  assert.equal(initial.diff.counts.added, 2);
  assert.equal(initial.diff.counts.changed, 0);

  const providerCalls = [];
  let paymentMetadata = null;
  let paymentAmount = null;
  const fakeYooKassaFetch = async (url, options = {}) => {
    const method = options.method || "GET";
    providerCalls.push({ method, url: String(url) });
    assert.ok(String(url).startsWith("https://api.yookassa.ru/v3/"));
    if (method === "POST" && url === "https://api.yookassa.ru/v3/payments") {
      const body = JSON.parse(options.body);
      paymentMetadata = body.metadata;
      paymentAmount = body.amount;
      return jsonResponse({
        id: PAYMENT_ID,
        status: "pending",
        paid: false,
        test: true,
        confirmation: { confirmation_url: `https://yookassa.test/confirm/${PAYMENT_ID}` },
      });
    }
    if (method === "GET" && url === `https://api.yookassa.ru/v3/payments/${PAYMENT_ID}`) {
      return jsonResponse({
        id: PAYMENT_ID,
        status: "succeeded",
        paid: true,
        test: true,
        amount: paymentAmount,
        metadata: paymentMetadata,
      });
    }
    throw new Error(`Unexpected YooKassa request: ${method} ${url}`);
  };

  try {
    await writeSchedule(dataDir, initial.batch);
    const config = e2eConfig(dataDir);
    const store = new MultiUniversityStore(config);
    const payments = new YooKassaService({ config, store, fetchFn: fakeYooKassaFetch });

    const result = await withServer(createHandler({ store, config, payments }), async (origin) => {
      const checkoutResponse = await fetch(`${origin}/api/v2/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          university_id: "ugmu",
          program: "medicine",
          course: 1,
          stream: "1",
          groupCode: "ОЛД 101",
          groupId: GROUP_ID,
          academicYear: "2026/2027",
          semester: 1,
          email: "student@example.com",
          plan: "semester",
        }),
      });
      assert.equal(checkoutResponse.status, 201);
      const checkout = await checkoutResponse.json();

      const webhookResponse = await fetch(`${origin}/api/v1/yookassa/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "payment.succeeded", object: { id: PAYMENT_ID } }),
      });
      assert.equal(webhookResponse.status, 200);

      const orderResponse = await fetch(`${origin}/api/v1/orders/${checkout.orderId}`, {
        headers: { "x-order-token": checkout.accessToken },
      });
      assert.equal(orderResponse.status, 200);
      const orderBefore = await orderResponse.json();
      assert.equal(orderBefore.status, "succeeded");
      const token = orderBefore.subscriptionUrl.match(/\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/)?.[1];
      assert.ok(token);
      const subscriptionPath = `${origin}/api/v1/subscriptions/${token}/calendar.ics`;

      const initialIcsResponse = await fetch(subscriptionPath);
      assert.equal(initialIcsResponse.status, 200);
      const initialIcs = await initialIcsResponse.text();
      const targetUid = `${TARGET_EVENT_ID}@ugmu-calendar`;
      const unchangedUid = `${UNCHANGED_EVENT_ID}@ugmu-calendar`;
      const initialTarget = blockForUid(initialIcs, targetUid);
      const initialUnchanged = blockForUid(initialIcs, unchangedUid);
      assert.equal(property(initialTarget, "SEQUENCE"), "0");
      assert.equal(property(initialTarget, "LOCATION"), "Онлайн");
      assert.equal(property(initialUnchanged, "SEQUENCE"), "0");
      assert.ok(unfoldIcs(initialIcs).includes(`X-SCHEDULE-VERSION:${INITIAL_VERSION}`));

      const updated = versioned(initial.batch, incomingSchedule("ул. Репина, 3, ауд. 101"), {
        now: "2026-08-20T19:00:00.000Z",
        versionId: UPDATED_VERSION,
      });
      assert.deepEqual(updated.diff.counts, {
        added: 0,
        changed: 1,
        removed: 0,
        unchanged: 1,
        total_new: 2,
      });
      assert.equal(updated.diff.changed[0]?.event_id, TARGET_EVENT_ID);
      await writeSchedule(dataDir, updated.batch);

      const providerCallsBeforeRefresh = providerCalls.length;
      const updatedIcsResponse = await fetch(subscriptionPath);
      assert.equal(updatedIcsResponse.status, 200);
      const updatedIcs = await updatedIcsResponse.text();
      const updatedTarget = blockForUid(updatedIcs, targetUid);
      const updatedUnchanged = blockForUid(updatedIcs, unchangedUid);
      assert.equal(property(updatedTarget, "SEQUENCE"), "1");
      assert.equal(property(updatedTarget, "LOCATION"), "ул. Репина\\, 3\\, ауд. 101");
      assert.equal(property(updatedUnchanged, "SEQUENCE"), "0");
      assert.ok(unfoldIcs(updatedIcs).includes(`X-SCHEDULE-VERSION:${UPDATED_VERSION}`));
      assert.equal(eventBlocks(initialIcs).length, 2);
      assert.equal(eventBlocks(updatedIcs).length, 2);
      assert.equal(providerCalls.length, providerCallsBeforeRefresh);

      const orderAfterResponse = await fetch(`${origin}/api/v1/orders/${checkout.orderId}`, {
        headers: { "x-order-token": checkout.accessToken },
      });
      assert.equal(orderAfterResponse.status, 200);
      const orderAfter = await orderAfterResponse.json();
      assert.equal(orderAfter.subscriptionUrl, orderBefore.subscriptionUrl);
      assert.equal(orderAfter.status, "succeeded");
      assert.equal(providerCalls.length, providerCallsBeforeRefresh);

      const publicPath = `${origin}/api/v2/schedules/ugmu/medicine/1/${encodeURIComponent(GROUP_ID)}/schedule?groupCode=${encodeURIComponent("ОЛД 101")}&stream=1`;
      const publicResponse = await fetch(publicPath);
      assert.equal(publicResponse.status, 404);

      return {
        checkoutStatus: checkoutResponse.status,
        webhookStatus: webhookResponse.status,
        initialIcsStatus: initialIcsResponse.status,
        updatedIcsStatus: updatedIcsResponse.status,
        publicScheduleStatusAfterUpdate: publicResponse.status,
        orderId: checkout.orderId,
        subscriptionUrl: orderBefore.subscriptionUrl,
        tokenLength: token.length,
        providerCallsBeforeRefresh,
        providerCallsAfterRefresh: providerCalls.length,
        initialVersion: INITIAL_VERSION,
        updatedVersion: UPDATED_VERSION,
        initialEventCount: eventBlocks(initialIcs).length,
        updatedEventCount: eventBlocks(updatedIcs).length,
        targetUid,
        targetInitialSequence: Number(property(initialTarget, "SEQUENCE")),
        targetUpdatedSequence: Number(property(updatedTarget, "SEQUENCE")),
        unchangedInitialSequence: Number(property(initialUnchanged, "SEQUENCE")),
        unchangedUpdatedSequence: Number(property(updatedUnchanged, "SEQUENCE")),
        initialLocation: property(initialTarget, "LOCATION"),
        updatedLocation: property(updatedTarget, "LOCATION"),
        subscriptionUrlStable: orderAfter.subscriptionUrl === orderBefore.subscriptionUrl,
      };
    });

    assert.equal(providerCalls.length, 2);
    assert.deepEqual(providerCalls.map((item) => item.method), ["POST", "GET"]);
    assert.equal(university.active, false);
    assert.equal(baseline.universityAccess.ugmu.checkoutEnabled, false);
    assert.equal(baseline.universityAccess.ugmu.publicEndpointsEnabled, false);
    assert.equal(baseline.universitySiteUrls.ugmu, "");

    const report = {
      version: 1,
      university: "ugmu",
      mode: "isolated-purchased-calendar-update-e2e",
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
      payment: {
        provider: "YooKassaService-production-code",
        providerCalls,
        externalRequests: 0,
        paymentsCreated: 1,
        paymentId: PAYMENT_ID,
      },
      update: {
        syntheticOfficialCorrection: true,
        changedField: "lesson.locations",
        diff: {
          added: 0,
          changed: 1,
          removed: 0,
          unchanged: 1,
        },
        ...result,
      },
      checks: {
        onePaymentOnly: providerCalls.filter((item) => item.method === "POST").length === 1,
        sameSubscriptionUrlAfterUpdate: result.subscriptionUrlStable === true,
        sameUidAfterUpdate: result.targetUid === `${TARGET_EVENT_ID}@ugmu-calendar`,
        sequenceAdvancedExactlyOnce: result.targetInitialSequence === 0 && result.targetUpdatedSequence === 1,
        unchangedEventSequenceStable: result.unchangedInitialSequence === 0 && result.unchangedUpdatedSequence === 0,
        noDuplicateVevent: result.initialEventCount === 2 && result.updatedEventCount === 2,
        newScheduleVersionServed: result.initialVersion === INITIAL_VERSION && result.updatedVersion === UPDATED_VERSION,
        changedLocationServedThroughOldSubscription: result.initialLocation === "Онлайн" && result.updatedLocation === "ул. Репина\\, 3\\, ауд. 101",
        noProviderCallOnCalendarRefresh: result.providerCallsBeforeRefresh === result.providerCallsAfterRefresh,
        publicScheduleRemainsClosed: result.publicScheduleStatusAfterUpdate === 404,
        productionRegistryInactive: university.active === false,
        productionCheckoutFailClosed: baseline.universityAccess.ugmu.checkoutEnabled === false,
        productionPublicFailClosed: baseline.universityAccess.ugmu.publicEndpointsEnabled === false,
        productionPaidRedirectEmpty: baseline.universitySiteUrls.ugmu === "",
      },
      launchAuthority: {
        productionSalesAllowedByThisE2e: false,
        productionPublicationAllowedByThisE2e: false,
        nextRequiredBoundary: "subscription-revoke-e2e",
      },
    };
    assert.ok(Object.values(report.checks).every(Boolean));

    const output = path.resolve(process.cwd(), reportPath || process.env.UGMU_PURCHASED_UPDATE_E2E_REPORT || "data/regression/ugmu-purchased-update-e2e-report.json");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log("UGMU purchased calendar update E2E: PASS");
    console.log(`Same subscription URL: ${report.checks.sameSubscriptionUrlAfterUpdate}`);
    console.log(`UID stable; SEQUENCE ${result.targetInitialSequence} -> ${result.targetUpdatedSequence}; payment POST count: 1`);
    console.log("External YooKassa network requests: 0");
    console.log(`Report: ${output}`);
    return report;
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runUgmuPurchasedCalendarUpdateE2e().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
