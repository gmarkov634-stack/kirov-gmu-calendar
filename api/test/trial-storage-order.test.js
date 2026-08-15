import assert from "node:assert/strict";
import test from "node:test";
import { TrialService } from "../src/trial-service.js";

function schedule() {
  const baseSystem = {
    schedule_version_id: "ver_trial_storage_order",
    fingerprint: `sha256:${"a".repeat(64)}`,
    revision: 1,
    created_at: "2026-08-15T07:00:00.000Z",
    updated_at: "2026-08-15T07:00:00.000Z",
  };
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
      schedule_version_id: "ver_trial_storage_order",
      previous_schedule_version_id: null,
      content_fingerprint: `sha256:${"b".repeat(64)}`,
      version_created_at: "2026-08-15T07:00:00.000Z",
    },
    events: [{
      schema_version: "1.0",
      system: { ...baseSystem, event_id: "evt_trial_storage_order" },
      timing: { date: "2026-09-01", start_time: "09:00", end_time: "10:30", all_day: false, time_mode: "floating" },
      calendar: { title: "Педиатрия", description: "1 из 12", location: null },
    }],
  };
}

const config = {
  trialsEnabled: true,
  offerAcademicYear: "2026/27",
  offerSemester: 1,
  publicApiUrl: "https://api.example.test",
  universitySiteUrls: { kgmu: "https://site.example.test/kirov-gmu-calendar" },
};

const input = {
  university: "kgmu",
  program: "pediatrics",
  course: 1,
  groupCode: "131",
  groupId: "kgmu:pediatrics:1:131",
};

test("conversion storage failure cannot leave a live trial subscription", async () => {
  const subscriptions = [];
  const store = {
    async getSchedule() { return schedule(); },
    async putTrialConversion() { throw new Error("conversion-storage-failed"); },
    async putSubscription(token, value) { subscriptions.push({ token, value }); },
  };
  const service = new TrialService({
    store,
    config,
    now: () => new Date("2026-08-15T07:00:00.000Z"),
  });

  await assert.rejects(service.create(input), /conversion-storage-failed/);
  assert.equal(subscriptions.length, 0);
});
