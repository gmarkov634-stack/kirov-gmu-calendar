import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { scheduleContext, scheduleStorageKey } from "../src/order-context.js";
import { MultiUniversityStore } from "../src/university-store.js";

const groupId = "ugmu:medicine:1:stream-1:ОЛД 101";
const ugmuSchedule = {
  version: 1,
  university: "ugmu",
  universityName: "УГМУ",
  program: "medicine",
  course: 1,
  stream: "1",
  group: {
    id: groupId,
    code: "ОЛД 101",
    displayName: "Группа ОЛД 101",
  },
  timezone: "Asia/Yekaterinburg",
  academicYear: "2026/2027",
  semester: 1,
  sources: [{ url: "https://usma.ru/wp-content/uploads/2026/08/1OLD.pdf" }],
  events: [{
    id: "evt_ugmu_old101_0001",
    title: "ЛЕКЦ. ХИМИЯ",
    start: "2026-09-01T08:50:00+05:00",
    end: "2026-09-01T10:20:00+05:00",
    location: "Онлайн",
  }],
};

function baseConfig(overrides = {}) {
  const runtime = loadConfig({
    COMMERCIAL_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    TRIALS_ENABLED: "true",
  });
  return {
    ...runtime,
    allowedOrigin: "https://example.test",
    allowedOrigins: ["https://example.test"],
    ...overrides,
  };
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("university_id=ugmu resolves to the canonical UGMU tenant and storage key", () => {
  const input = {
    university_id: "ugmu",
    program: "medicine",
    course: 1,
    stream: "1",
    groupCode: "ОЛД 101",
    groupId,
    academicYear: "2026/2027",
    semester: 1,
  };
  const context = scheduleContext(input);
  assert.equal(context.university, "ugmu");
  assert.equal(context.universityName, "УГМУ");
  assert.equal(context.timezone, "Asia/Yekaterinburg");
  assert.equal(
    scheduleStorageKey(input),
    `schedules/ugmu/medicine/1/2026-2027/semester-1/${encodeURIComponent(groupId)}.json`,
  );
});

test("MultiUniversityStore reads a UGMU schedule through university_id routing", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-api-routing-"));
  const key = scheduleStorageKey(ugmuSchedule);
  const filename = path.join(dataDir, key);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(ugmuSchedule));

  const store = new MultiUniversityStore({
    dataDir,
    cacheTtlMs: 0,
    offerAcademicYear: "2026/2027",
    offerSemester: 1,
  });
  const loaded = await store.getSchedule({
    university_id: "ugmu",
    program: "medicine",
    course: 1,
    stream: "1",
    groupCode: "ОЛД 101",
    groupId,
    academicYear: "2026/2027",
    semester: 1,
  });
  assert.equal(loaded?.university, "ugmu");
  assert.equal(loaded?.group?.code, "ОЛД 101");
  assert.equal(loaded?.timezone, "Asia/Yekaterinburg");
});

test("UGMU checkout stays closed even when global sales are enabled", async () => {
  let storeCalls = 0;
  let paymentCalls = 0;
  const store = {
    getSchedule: async () => {
      storeCalls += 1;
      return ugmuSchedule;
    },
  };
  const payments = {
    enabled: true,
    create: async () => {
      paymentCalls += 1;
      return { orderId: "o".repeat(32), confirmationUrl: "https://pay.test" };
    },
  };

  await withServer(createHandler({ store, config: baseConfig(), payments }), async (origin) => {
    const response = await fetch(`${origin}/api/v2/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        university_id: "ugmu",
        program: "medicine",
        course: 1,
        stream: "1",
        groupCode: "ОЛД 101",
        groupId,
        email: "student@example.com",
      }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "university_sales_not_open" });
  });

  assert.equal(storeCalls, 0);
  assert.equal(paymentCalls, 0);
});

test("UGMU public schedule stays closed even when global public endpoints are enabled", async () => {
  let storeCalls = 0;
  const store = {
    getSchedule: async () => {
      storeCalls += 1;
      return ugmuSchedule;
    },
  };
  const encodedGroup = encodeURIComponent(groupId);
  const query = new URLSearchParams({ groupCode: "ОЛД 101", stream: "1" });

  await withServer(createHandler({ store, config: baseConfig(), payments: null }), async (origin) => {
    const response = await fetch(`${origin}/api/v2/schedules/ugmu/medicine/1/${encodedGroup}/schedule?${query}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "schedule_not_published" });
  });

  assert.equal(storeCalls, 0);
});

test("UGMU access policy cannot be opened through environment flags", () => {
  const config = loadConfig({
    COMMERCIAL_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    TRIALS_ENABLED: "true",
    UGMU_SITE_URL: "https://should-not-open.example",
  });
  assert.deepEqual(config.universityAccess.ugmu, {
    apiRoutingEnabled: true,
    publicEndpointsEnabled: false,
    checkoutEnabled: false,
    trialsEnabled: false,
  });
  assert.equal(config.universitySiteUrls.ugmu, "");
});

test("conflicting university and university_id values are rejected", async () => {
  let storeCalls = 0;
  const store = {
    getSchedule: async () => {
      storeCalls += 1;
      return ugmuSchedule;
    },
  };
  const payments = { enabled: true, create: async () => ({ confirmationUrl: "https://pay.test" }) };

  await withServer(createHandler({ store, config: baseConfig(), payments }), async (origin) => {
    const response = await fetch(`${origin}/api/v2/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        university: "omgmu",
        university_id: "ugmu",
        program: "medicine",
        course: 1,
        groupCode: "ОЛД 101",
        groupId,
        email: "student@example.com",
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_checkout" });
  });
  assert.equal(storeCalls, 0);
});
