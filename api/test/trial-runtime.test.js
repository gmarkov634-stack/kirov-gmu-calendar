import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTrialHttpHandler } from "../src/trial-http-handler.js";
import { TrialService } from "../src/trial-service.js";
import { TrialEnabledStore } from "../src/trial-store.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function event(id, date, index) {
  return {
    schema_version: "1.0",
    system: {
      event_id: id,
      schedule_version_id: "ver_trial_runtime",
      fingerprint: `sha256:${String(index).padStart(64, "a").slice(-64)}`,
      revision: 1,
      created_at: "2026-08-15T07:00:00.000Z",
      updated_at: "2026-08-15T07:00:00.000Z",
    },
    timing: {
      date,
      start_time: "09:00",
      end_time: "10:30",
      all_day: false,
      time_mode: "floating",
    },
    derived: { sequence: { index, total: 12, bucket: "class" } },
    calendar: {
      title: `Педиатрия ${index}`,
      description: `${index} из 12`,
      location: null,
    },
  };
}

function schedule() {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "pediatrics",
      course: 1,
      group: "131",
      period: { start_date: "2026-09-01", end_date: "2026-12-31", week1_start_date: "2026-08-31" },
      schedule_version_id: "ver_trial_runtime",
      previous_schedule_version_id: null,
      content_fingerprint: `sha256:${"b".repeat(64)}`,
      version_created_at: "2026-08-15T07:00:00.000Z",
    },
    events: [
      event("evt_trial_day1", "2026-09-01", 4),
      event("evt_trial_day7", "2026-09-07", 5),
      event("evt_trial_day8", "2026-09-08", 6),
    ],
  };
}

function config(overrides = {}) {
  return {
    trialsEnabled: true,
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    publicApiUrl: "https://api.example.test",
    universitySiteUrls: { kgmu: "https://site.example.test/kirov-gmu-calendar" },
    allowedOrigins: ["https://site.example.test"],
    subscriptionSigningSecret: "s".repeat(32),
    cacheTtlMs: 0,
    ...overrides,
  };
}

function fakeStore() {
  return {
    schedule: schedule(),
    subscriptions: new Map(),
    conversions: new Map(),
    accessCount: 0,
    async getSchedule() { return this.schedule; },
    async putSubscription(token, value) { this.subscriptions.set(token, value); },
    async getSubscription(token) { return this.subscriptions.get(token) || null; },
    async putTrialConversion(id, value) { this.conversions.set(id, value); },
    async getTrialConversion(id) { return this.conversions.get(id) || null; },
    async recordSubscriptionAccess() { this.accessCount += 1; },
  };
}

test("trial conversion storage uses a hashed object name", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "trial-store-"));
  try {
    const store = new TrialEnabledStore(config({ dataDir }));
    const conversionId = "C".repeat(43);
    const value = { version: 1, status: "active", groupCode: "131" };
    await store.putTrialConversion(conversionId, value);

    const names = await fs.readdir(path.join(dataDir, "trial-conversions"));
    assert.equal(names.length, 1);
    assert.match(names[0], /^[a-f0-9]{64}\.json$/);
    assert.equal(names[0].includes(conversionId), false);
    assert.deepEqual(await store.getTrialConversion(conversionId), value);
    assert.equal(await store.getTrialConversion("invalid"), null);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("trial HTTP runtime creates, restores and serves only the fixed first week", async () => {
  const store = fakeStore();
  const cfg = config();
  const trials = new TrialService({
    store,
    config: cfg,
    now: () => new Date("2026-08-15T07:00:00.000Z"),
  });
  const runtime = createTrialHttpHandler({ store, config: cfg, trials });

  await withServer(async (request, response) => {
    if (await runtime.handleApi(request, response)) return;
    if (await runtime.handleSubscription(request, response)) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  }, async (base) => {
    const createResponse = await fetch(`${base}/api/v2/trials`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://site.example.test" },
      body: JSON.stringify({
        university: "kgmu",
        program: "pediatrics",
        course: 1,
        groupCode: "131",
        groupId: "kgmu:pediatrics:1:131",
        source: "vk",
        campaign: "fall-2026",
      }),
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.headers.get("access-control-allow-origin"), "https://site.example.test");
    const created = await createResponse.json();
    const token = new URL(created.subscriptionUrl).pathname.match(/\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/)?.[1];
    assert.ok(token);

    const feedResponse = await fetch(`${base}/api/v1/subscriptions/${token}/calendar.ics`);
    assert.equal(feedResponse.status, 200);
    assert.equal(feedResponse.headers.get("x-subscription-entitlement"), "trial");
    assert.equal(feedResponse.headers.get("x-trial-end-date-exclusive"), "2026-09-08");
    const ics = await feedResponse.text();
    assert.match(ics, /UID:evt_trial_day1@kgmu-calendar/);
    assert.match(ics, /UID:evt_trial_day7@kgmu-calendar/);
    assert.doesNotMatch(ics, /UID:evt_trial_day8@kgmu-calendar/);
    assert.match(ics, /SUMMARY:Продолжить календарь на семестр/);
    assert.equal(store.accessCount, 1);

    const continueResponse = await fetch(`${base}/api/v2/trials/continue/${created.conversionId}`);
    assert.equal(continueResponse.status, 200);
    const context = await continueResponse.json();
    assert.equal(context.groupCode, "131");
    assert.equal(context.attribution.campaign, "fall-2026");
    assert.equal("trialTokenHash" in context, false);
    assert.equal("conversionIdHash" in context, false);

    store.subscriptions.set(token, { ...store.subscriptions.get(token), status: "upgraded" });
    const upgradedResponse = await fetch(`${base}/api/v1/subscriptions/${token}/calendar.ics`);
    assert.equal(upgradedResponse.status, 200);
    assert.equal(upgradedResponse.headers.get("x-subscription-status"), "upgraded");
    assert.doesNotMatch(await upgradedResponse.text(), /BEGIN:VEVENT/);
  });
});
