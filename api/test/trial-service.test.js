import assert from "node:assert/strict";
import test from "node:test";
import { TrialService } from "../src/trial-service.js";

function event(id, date) {
  return {
    schema_version: "1.0",
    system: {
      event_id: id,
      schedule_version_id: "ver_trial_service",
      fingerprint: `sha256:${"a".repeat(64)}`,
      revision: 1,
      created_at: "2026-08-15T07:00:00.000Z",
      updated_at: "2026-08-15T07:00:00.000Z",
    },
    timing: { date, start_time: "09:00", end_time: "10:30", all_day: false, time_mode: "floating" },
    calendar: { title: "Педиатрия", description: "1 из 12", location: null },
  };
}

function canonicalSchedule({ semester = "autumn", academicYear = "2026/2027" } = {}) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: academicYear,
      semester,
      faculty_code: "pediatrics",
      course: 1,
      group: "131",
      period: { start_date: "2026-09-01", end_date: "2026-12-31", week1_start_date: "2026-08-31" },
      schedule_version_id: "ver_trial_service",
      previous_schedule_version_id: null,
      content_fingerprint: `sha256:${"b".repeat(64)}`,
      version_created_at: "2026-08-15T07:00:00.000Z",
    },
    events: [event("evt_1", "2026-09-01"), event("evt_2", "2026-09-07"), event("evt_3", "2026-09-08")],
  };
}

function config(overrides = {}) {
  return {
    trialsEnabled: true,
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    publicApiUrl: "https://api.example.test",
    universitySiteUrls: { kgmu: "https://site.example.test/kirov-gmu-calendar" },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    groupCode: "131",
    groupId: "kgmu:pediatrics:1:131",
    source: "vk",
    medium: "post",
    campaign: "fall-2026",
    referral: "starosta-131",
    ...overrides,
  };
}

function fakeStore(schedule = canonicalSchedule()) {
  return {
    schedule,
    subscriptions: [],
    conversions: new Map(),
    async getSchedule() { return this.schedule; },
    async putSubscription(token, value) { this.subscriptions.push({ token, value }); },
    async putTrialConversion(id, value) { this.conversions.set(id, value); },
    async getTrialConversion(id) { return this.conversions.get(id) || null; },
  };
}

test("trial feature gate is fail-closed", async () => {
  const store = fakeStore();
  const service = new TrialService({ store, config: config({ trialsEnabled: false }) });
  await assert.rejects(service.create(input()), (error) => error.code === "trials_not_open");
  assert.equal(store.subscriptions.length, 0);
});

test("trial is created from the first real academic week without a payment", async () => {
  const store = fakeStore();
  const service = new TrialService({
    store,
    config: config(),
    now: () => new Date("2026-08-15T07:00:00.000Z"),
  });
  const result = await service.create(input());

  assert.equal(result.status, "active");
  assert.equal(result.groupCode, "131");
  assert.equal(result.trialStartDate, "2026-09-01");
  assert.equal(result.trialEndDateExclusive, "2026-09-08");
  assert.match(result.subscriptionUrl, /^https:\/\/api\.example\.test\/api\/v1\/subscriptions\/[A-Za-z0-9_-]{43}\/calendar\.ics$/);
  assert.match(result.conversionId, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.continueUrl, /^https:\/\/site\.example\.test\/kirov-gmu-calendar\/\?continue=/);

  assert.equal(store.subscriptions.length, 1);
  const subscription = store.subscriptions[0].value;
  assert.equal(subscription.version, 2);
  assert.equal(subscription.entitlement, "trial");
  assert.equal(subscription.plan, "semester");
  assert.equal(subscription.groupId, "kgmu:pediatrics:1:131");
  assert.equal(subscription.trialEndDateExclusive, "2026-09-08");

  const conversion = store.conversions.get(result.conversionId);
  assert.equal(conversion.trialTokenHash.length, 64);
  assert.equal(conversion.conversionIdHash.length, 64);
  assert.equal(conversion.attribution.source, "vk");
  assert.equal(conversion.attribution.referral, "starosta-131");
});

test("repeated trial creation never moves the fixed window", async () => {
  const store = fakeStore();
  const service = new TrialService({
    store,
    config: config(),
    now: () => new Date("2026-09-04T09:00:00.000Z"),
  });
  const first = await service.create(input());
  const second = await service.create(input());
  assert.notEqual(first.subscriptionUrl, second.subscriptionUrl);
  assert.equal(first.trialStartDate, second.trialStartDate);
  assert.equal(first.trialEndDateExclusive, second.trialEndDateExclusive);
  assert.equal(second.trialEndDateExclusive, "2026-09-08");
});

test("new trial is closed when the fixed first-week window is already over", async () => {
  const store = fakeStore();
  const service = new TrialService({
    store,
    config: config(),
    now: () => new Date("2026-09-08T09:00:00.000Z"),
  });
  await assert.rejects(service.create(input()), (error) => error.code === "trial_window_closed");
  assert.equal(store.subscriptions.length, 0);
});

test("unpublished or wrong-period schedule fails closed", async () => {
  const missing = fakeStore(null);
  const missingService = new TrialService({ missing, store: missing, config: config() });
  await assert.rejects(missingService.create(input()), (error) => error.code === "offer_not_found");

  const wrong = fakeStore(canonicalSchedule({ semester: "spring" }));
  const wrongService = new TrialService({ store: wrong, config: config() });
  await assert.rejects(wrongService.create(input()), (error) => error.code === "offer_not_found");
});

test("continue context never exposes trial token hashes", async () => {
  const store = fakeStore();
  const service = new TrialService({
    store,
    config: config(),
    now: () => new Date("2026-08-15T07:00:00.000Z"),
  });
  const created = await service.create(input());
  const context = await service.continue(created.conversionId);
  assert.equal(context.groupCode, "131");
  assert.equal(context.attribution.campaign, "fall-2026");
  assert.equal("trialTokenHash" in context, false);
  assert.equal("conversionIdHash" in context, false);
  assert.equal(JSON.stringify(context).includes(store.subscriptions[0].token), false);
});
