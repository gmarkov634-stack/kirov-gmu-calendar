import assert from "node:assert/strict";
import test from "node:test";
import {
  runtimeTrialContextAllowed,
  trialServiceEnabled,
  ugmuTrialScopeAllowed,
} from "../src/trial-access-policy.mjs";
import { TrialService } from "../src/trial-service.js";

function ugmuContext(overrides = {}) {
  return {
    university: "ugmu",
    program: "medicine",
    course: 1,
    stream: "1",
    groupCode: "ОЛД 101",
    groupId: "ugmu:medicine:1:stream-1:ОЛД 101",
    ...overrides,
  };
}

function event(id, date) {
  return {
    schema_version: "1.0",
    system: {
      event_id: id,
      schedule_version_id: "ver_ugmu_trial_test",
      fingerprint: `sha256:${"a".repeat(64)}`,
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
    audience: { stream: "1" },
    calendar: { title: "Анатомия", description: "1 из 12", location: null },
  };
}

function ugmuSchedule() {
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
      group_id: "ugmu:medicine:1:stream-1:ОЛД 101",
      timezone: "Asia/Yekaterinburg",
      period: {
        start_date: "2026-09-01",
        end_date: "2027-01-10",
        week1_start_date: "2026-09-01",
      },
      schedule_version_id: "ver_ugmu_trial_test",
      previous_schedule_version_id: null,
      content_fingerprint: `sha256:${"b".repeat(64)}`,
      version_created_at: "2026-08-15T07:00:00.000Z",
    },
    events: [event("evt_1", "2026-09-01"), event("evt_2", "2026-09-07"), event("evt_3", "2026-09-08")],
  };
}

function serviceConfig(overrides = {}) {
  return {
    trialsEnabled: false,
    globalTrialsEnabled: false,
    ugmuTrialsEnabled: true,
    trialServiceEnabled: true,
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    publicApiUrl: "https://api.example.test",
    universitySiteUrls: { ugmu: "https://site.example.test/ugmu" },
    ...overrides,
  };
}

function fakeStore(schedule = ugmuSchedule()) {
  return {
    schedule,
    subscriptions: [],
    conversions: new Map(),
    reads: 0,
    async getSchedule() {
      this.reads += 1;
      return this.schedule;
    },
    async putSubscription(token, value) {
      this.subscriptions.push({ token, value });
    },
    async putTrialConversion(id, value) {
      this.conversions.set(id, value);
    },
    async getTrialConversion(id) {
      return this.conversions.get(id) || null;
    },
  };
}

test("UGMU trial scope is locked to medicine course 1 stream I groups OLD 101-112", () => {
  for (let value = 101; value <= 112; value += 1) {
    const groupCode = `ОЛД ${value}`;
    assert.equal(ugmuTrialScopeAllowed(ugmuContext({
      groupCode,
      groupId: `ugmu:medicine:1:stream-1:${groupCode}`,
    })), true);
  }

  for (const context of [
    ugmuContext({ program: "pediatrics", groupId: "ugmu:pediatrics:1:stream-1:ОЛД 101" }),
    ugmuContext({ course: 2, groupId: "ugmu:medicine:2:stream-1:ОЛД 101" }),
    ugmuContext({ stream: "2", groupId: "ugmu:medicine:1:stream-2:ОЛД 101" }),
    ugmuContext({ groupCode: "ОЛД 100", groupId: "ugmu:medicine:1:stream-1:ОЛД 100" }),
    ugmuContext({ groupCode: "ОЛД 113", groupId: "ugmu:medicine:1:stream-1:ОЛД 113" }),
    ugmuContext({ groupId: "ugmu:medicine:1:ОЛД 101" }),
  ]) {
    assert.equal(ugmuTrialScopeAllowed(context), false);
  }
});

test("global and UGMU trial gates cannot open each other", () => {
  const kgmu = {
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    groupCode: "131",
    groupId: "kgmu:pediatrics:1:131",
  };
  const ugmu = ugmuContext();

  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: false, ugmuTrialsEnabled: false }, kgmu), false);
  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: false, ugmuTrialsEnabled: false }, ugmu), false);

  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: true, ugmuTrialsEnabled: false }, kgmu), true);
  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: true, ugmuTrialsEnabled: false }, ugmu), false);

  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: false, ugmuTrialsEnabled: true }, kgmu), false);
  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: false, ugmuTrialsEnabled: true }, ugmu), true);

  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: true, ugmuTrialsEnabled: true }, kgmu), true);
  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: true, ugmuTrialsEnabled: true }, ugmu), true);
});

test("dedicated UGMU flag enables the trial service without changing global trial state", () => {
  assert.equal(trialServiceEnabled({ trialsEnabled: false, ugmuTrialsEnabled: true }), true);
  assert.equal(trialServiceEnabled({ trialsEnabled: false, ugmuTrialsEnabled: false }), false);
});

test("UGMU exact-scope trial creates a tokenized subscription without payment", async () => {
  const store = fakeStore();
  const service = new TrialService({
    store,
    config: serviceConfig(),
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  });

  const result = await service.create(ugmuContext());
  assert.equal(result.status, "active");
  assert.equal(result.groupCode, "ОЛД 101");
  assert.equal(result.trialStartDate, "2026-09-01");
  assert.equal(result.trialEndDateExclusive, "2026-09-08");
  assert.match(result.subscriptionUrl, /^https:\/\/api\.example\.test\/api\/v1\/subscriptions\/[A-Za-z0-9_-]{43}\/calendar\.ics$/);
  assert.equal(store.subscriptions.length, 1);
  assert.equal(store.subscriptions[0].value.entitlement, "trial");
  assert.equal(store.subscriptions[0].value.university, "ugmu");
  assert.equal(store.subscriptions[0].value.groupId, "ugmu:medicine:1:stream-1:ОЛД 101");
});

test("UGMU out-of-scope trial fails before schedule storage is read", async () => {
  const store = fakeStore();
  const service = new TrialService({
    store,
    config: serviceConfig(),
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  });

  await assert.rejects(
    service.create(ugmuContext({
      course: 2,
      groupId: "ugmu:medicine:2:stream-1:ОЛД 101",
    })),
    (error) => error.code === "university_trials_not_open",
  );
  assert.equal(store.reads, 0);
  assert.equal(store.subscriptions.length, 0);
});

test("global TRIALS_ENABLED cannot create an UGMU trial", async () => {
  const store = fakeStore();
  const service = new TrialService({
    store,
    config: serviceConfig({
      trialsEnabled: true,
      globalTrialsEnabled: true,
      ugmuTrialsEnabled: false,
      trialServiceEnabled: true,
    }),
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  });

  await assert.rejects(service.create(ugmuContext()), (error) => error.code === "university_trials_not_open");
  assert.equal(store.reads, 0);
  assert.equal(store.subscriptions.length, 0);
});
