import assert from "node:assert/strict";
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
import { YooKassaService } from "../src/yookassa.js";

const SOURCE_SHA = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const GROUP_ID = "ugmu:medicine:1:stream-1:ОЛД 101";
const PAYMENT_ID = "pay_ugmu_e2e_001";
const EXPECTED_SEMESTER_END = "2027-01-09T10:20:00.000Z";

function event({ id, date, start, end, title, location }) {
  const stamp = "2026-08-20T18:00:00.000Z";
  return {
    system: { event_id: id, revision: 1, created_at: stamp, updated_at: stamp },
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
      schedule_version_id: "ver_ugmu_old101_payment_e2e",
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

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
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
    allowedOrigin: "https://e2e.example",
    allowedOrigins: ["https://e2e.example"],
    publicApiUrl: "https://api.e2e.example",
    publicBaseUrl: "https://site.e2e.example/ugmu/",
    universitySiteUrls: { ...runtime.universitySiteUrls, ugmu: "https://site.e2e.example/ugmu" },
    universityAccess: {
      ...runtime.universityAccess,
      ugmu: {
        apiRoutingEnabled: true,
        publicEndpointsEnabled: false,
        checkoutEnabled: true,
        trialsEnabled: false,
      },
    },
    yookassaShopId: "ugmu-e2e-shop",
    yookassaSecretKey: "ugmu-e2e-secret",
    yookassaTestMode: true,
    yookassaSendReceipt: true,
    receiptVatCode: 1,
    subscriptionSigningSecret: "ugmu-payment-e2e-signing-secret-32-bytes-minimum",
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

export async function runUgmuPaymentE2e({ reportPath } = {}) {
  const startedAt = new Date().toISOString();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-payment-e2e-"));
  const schedule = canonicalSchedule();
  const config = e2eConfig(dataDir);
  const baseline = loadConfig({
    COMMERCIAL_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    TRIALS_ENABLED: "true",
    UGMU_SITE_URL: "https://must-not-open.example",
  });
  const university = getUniversityConfig("ugmu");
  const yookassaCalls = [];
  let createBody = null;
  let idempotenceKey = null;

  const fakeYooKassaFetch = async (url, options = {}) => {
    const method = options.method || "GET";
    yookassaCalls.push({ url: String(url), method });
    assert.ok(String(url).startsWith("https://api.yookassa.ru/v3/"), "unexpected external URL");
    assert.equal(options.headers?.Authorization, `Basic ${Buffer.from("ugmu-e2e-shop:ugmu-e2e-secret").toString("base64")}`);

    if (method === "POST" && url === "https://api.yookassa.ru/v3/payments") {
      idempotenceKey = options.headers?.["Idempotence-Key"];
      assert.match(String(idempotenceKey || ""), /^[0-9a-f-]{36}$/i);
      createBody = JSON.parse(options.body);
      assert.deepEqual(createBody.amount, { value: "299.00", currency: "RUB" });
      assert.equal(createBody.capture, true);
      assert.equal(createBody.confirmation?.type, "redirect");
      assert.match(createBody.confirmation?.return_url || "", /^https:\/\/site\.e2e\.example\/ugmu\/#order=[A-Za-z0-9_-]{32}&access=[A-Za-z0-9_-]{43}$/);
      assert.equal(createBody.metadata?.university, "ugmu");
      assert.equal(createBody.metadata?.group_id, GROUP_ID);
      assert.equal(createBody.metadata?.plan, "semester");
      assert.equal(createBody.receipt?.customer?.email, "student@example.com");
      assert.equal(createBody.receipt?.items?.[0]?.vat_code, 1);
      return jsonResponse({
        id: PAYMENT_ID,
        status: "pending",
        paid: false,
        test: true,
        confirmation: { confirmation_url: `https://yookassa.test/confirm/${PAYMENT_ID}` },
      });
    }

    if (method === "GET" && url === `https://api.yookassa.ru/v3/payments/${PAYMENT_ID}`) {
      assert.ok(createBody, "payment status requested before create");
      return jsonResponse({
        id: PAYMENT_ID,
        status: "succeeded",
        paid: true,
        test: true,
        amount: createBody.amount,
        metadata: createBody.metadata,
      });
    }

    throw new Error(`Unexpected YooKassa request: ${method} ${url}`);
  };

  try {
    await writeSchedule(dataDir, schedule);
    const store = new MultiUniversityStore(config);
    const payments = new YooKassaService({ config, store, fetchFn: fakeYooKassaFetch });
    assert.equal(payments.enabled, true);

    const result = await withServer(createHandler({ store, config, payments }), async (origin) => {
      const publicPath = `${origin}/api/v2/schedules/ugmu/medicine/1/${encodeURIComponent(GROUP_ID)}/schedule?groupCode=${encodeURIComponent("ОЛД 101")}&stream=1`;
      const publicResponse = await fetch(publicPath);
      assert.equal(publicResponse.status, 404);
      assert.deepEqual(await publicResponse.json(), { error: "schedule_not_published" });

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
      assert.match(checkout.orderId, /^[A-Za-z0-9_-]{32}$/);
      assert.match(checkout.accessToken, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(checkout.confirmationUrl, `https://yookassa.test/confirm/${PAYMENT_ID}`);

      const unauthenticatedOrder = await fetch(`${origin}/api/v1/orders/${checkout.orderId}`);
      assert.equal(unauthenticatedOrder.status, 403);
      assert.deepEqual(await unauthenticatedOrder.json(), { error: "order_forbidden" });

      const webhookResponse = await fetch(`${origin}/api/v1/yookassa/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "payment.succeeded", object: { id: PAYMENT_ID } }),
      });
      assert.equal(webhookResponse.status, 200);
      assert.deepEqual(await webhookResponse.json(), { status: "ok" });

      const orderResponse = await fetch(`${origin}/api/v1/orders/${checkout.orderId}`, {
        headers: { "x-order-token": checkout.accessToken },
      });
      assert.equal(orderResponse.status, 200);
      const order = await orderResponse.json();
      assert.equal(order.status, "succeeded");
      assert.equal(order.university, "ugmu");
      assert.equal(order.groupId, GROUP_ID);
      assert.equal(order.testMode, true);
      assert.equal(order.amount, "299.00");
      assert.match(order.subscriptionUrl || "", /^https:\/\/api\.e2e\.example\/api\/v1\/subscriptions\/[A-Za-z0-9_-]{43}\/calendar\.ics$/);

      const token = order.subscriptionUrl.match(/\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/)?.[1];
      assert.ok(token);
      const storedSubscription = await store.getSubscription(token);
      assert.equal(storedSubscription?.status, "active");
      assert.equal(storedSubscription?.entitlement, "paid");
      assert.equal(storedSubscription?.university, "ugmu");
      assert.equal(storedSubscription?.groupId, GROUP_ID);
      assert.equal(storedSubscription?.expiresAt, EXPECTED_SEMESTER_END);

      const icsResponse = await fetch(`${origin}/api/v1/subscriptions/${token}/calendar.ics`);
      assert.equal(icsResponse.status, 200);
      assert.match(icsResponse.headers.get("content-type") || "", /^text\/calendar/);
      const ics = await icsResponse.text();
      assert.ok(ics.includes("BEGIN:VCALENDAR"));
      assert.ok(ics.includes("X-WR-CALNAME:УГМУ · Группа ОЛД 101"));
      assert.ok(ics.includes("UID:evt_ugmu_old101_0001@ugmu-calendar"));
      assert.ok(ics.includes("SUMMARY:ЛЕКЦ. ХИМИЯ"));
      assert.ok(ics.includes("DTSTART:20260901T085000"));

      return {
        origin,
        checkoutStatus: checkoutResponse.status,
        webhookStatus: webhookResponse.status,
        orderStatus: order.status,
        orderId: checkout.orderId,
        tokenLength: token.length,
        subscriptionUrl: order.subscriptionUrl,
        icsStatus: icsResponse.status,
        icsBytes: Buffer.byteLength(ics),
        publicScheduleStatus: publicResponse.status,
        unauthorizedOrderStatus: unauthenticatedOrder.status,
        expiresAt: storedSubscription.expiresAt,
      };
    });

    assert.equal(yookassaCalls.length, 2);
    assert.deepEqual(yookassaCalls.map((item) => item.method), ["POST", "GET"]);
    assert.equal(baseline.universityAccess.ugmu.apiRoutingEnabled, true);
    assert.equal(baseline.universityAccess.ugmu.publicEndpointsEnabled, false);
    assert.equal(baseline.universityAccess.ugmu.checkoutEnabled, false);
    assert.equal(baseline.universityAccess.ugmu.trialsEnabled, false);
    assert.equal(baseline.universitySiteUrls.ugmu, "");
    assert.equal(university.active, false);

    const report = {
      version: 1,
      university: "ugmu",
      mode: "isolated-http-yookassa-e2e",
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
        network: "deterministic-local-fetch-stub",
        externalRequests: 0,
        providerCalls: yookassaCalls,
        paymentId: PAYMENT_ID,
        amount: "299.00",
        currency: "RUB",
        receiptChecked: true,
        idempotenceKeyChecked: Boolean(idempotenceKey),
      },
      http: result,
      checks: {
        publicScheduleRemainsClosed: result.publicScheduleStatus === 404,
        checkoutCreated: result.checkoutStatus === 201,
        orderAccessProtected: result.unauthorizedOrderStatus === 403,
        webhookFulfilled: result.webhookStatus === 200 && result.orderStatus === "succeeded",
        paidSubscriptionIssued: result.tokenLength === 43,
        personalIcsServed: result.icsStatus === 200 && result.icsBytes > 0,
        ugmuSemesterOffsetApplied: result.expiresAt === EXPECTED_SEMESTER_END,
        productionRegistryInactive: university.active === false,
        productionCheckoutFailClosed: baseline.universityAccess.ugmu.checkoutEnabled === false,
        productionPublicFailClosed: baseline.universityAccess.ugmu.publicEndpointsEnabled === false,
        productionPaidRedirectEmpty: baseline.universitySiteUrls.ugmu === "",
        noExternalYooKassaNetwork: yookassaCalls.length === 2,
      },
      launchAuthority: {
        productionSalesAllowedByThisE2e: false,
        productionPublicationAllowedByThisE2e: false,
      },
    };
    assert.ok(Object.values(report.checks).every(Boolean));

    const output = path.resolve(process.cwd(), reportPath || process.env.UGMU_PAYMENT_E2E_REPORT || "data/regression/ugmu-payment-e2e-report.json");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log("UGMU YooKassa E2E: PASS");
    console.log(`Payment -> webhook -> paid subscription -> ICS: ${result.checkoutStatus} -> ${result.webhookStatus} -> ${result.orderStatus} -> ${result.icsStatus}`);
    console.log("External YooKassa network requests: 0");
    console.log(`Report: ${output}`);
    return report;
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runUgmuPaymentE2e().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
