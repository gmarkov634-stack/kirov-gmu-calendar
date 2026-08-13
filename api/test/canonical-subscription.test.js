import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createHandler } from "../src/app.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const token = "A".repeat(43);

function canonicalSchedule() {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "kgmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "pediatrics",
      course: 4,
      group: "401",
      period: { start_date: "2026-09-01", end_date: "2026-12-28", week1_start_date: "2026-08-31" },
      source_files: ["schedule.xlsx"],
      generated_at: null,
      parser: "chatgpt-rules",
      schedule_version_id: "ver_subscription_test",
      previous_schedule_version_id: null,
      content_fingerprint: `sha256:${"a".repeat(64)}`,
      version_created_at: "2026-08-13T09:00:00.000Z",
    },
    events: [{
      schema_version: "1.0",
      system: {
        event_id: "evt_subscription_test",
        schedule_version_id: "ver_subscription_test",
        fingerprint: `sha256:${"b".repeat(64)}`,
        revision: 1,
        created_at: "2026-08-13T09:00:00.000Z",
        updated_at: "2026-08-13T09:00:00.000Z",
      },
      university: { code: "kgmu", name: "Кировский ГМУ" },
      academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "pediatrics", faculty_name: "Педиатрический факультет", course: 4 },
      audience: { group: "401", scope: "whole_group", subgroups: [], stream: null },
      timing: { date: "2026-09-14", start_time: "09:00", end_time: "10:30", all_day: false, time_mode: "floating" },
      lesson: {
        discipline: { raw: "ПЕДИАТРИЯ", normalized: "Педиатрия" },
        type: { raw: "практ.", code: "practice" },
        teachers: [], locations: [], source_note: null, cycle_id: null, joint_groups: [],
      },
      source: { file_name: "schedule.xlsx", file_hash: null, sheet: "4 курс", references: [], raw_text: null },
      parse: { status: "ok", rule_ids: [], warnings: [] },
      derived: {
        academic_week: 3,
        sequence: { index: 1, total: 1, bucket: "class" },
        next_same_event: null,
        is_last_same_event: true,
        day: { index: 1, total: 1, remaining: 0, next_event: null, gap_minutes: null, overlaps_next: false },
        cycle: null,
        assessment: null,
      },
      calendar: { title: "Педиатрия", description: "Практическое занятие · 1 из 1", location: null },
    }],
  };
}

test("existing tokenized subscription endpoint serves canonical schedule-batch", () => withServer(
  createHandler({
    store: {
      getSubscription: async (actualToken) => actualToken === token ? {
        version: 2,
        status: "active",
        plan: "semester",
        university: "kgmu",
        program: "pediatrics",
        course: 4,
        groupCode: "401",
        groupId: "kgmu:pediatrics:4:401",
        groupDisplayName: "Группа 401",
        academicYear: "2026/2027",
        semester: 1,
        expiresAt: "2027-01-31T23:59:59+03:00",
      } : null,
      getSchedule: async () => canonicalSchedule(),
      recordSubscriptionAccess: async () => null,
    },
    config: {
      allowedOrigin: "https://example.test",
      enablePublicEndpoints: false,
      subscriptionSigningSecret: "s".repeat(32),
      universitySiteUrls: { kgmu: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/" },
    },
  }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/subscriptions/${token}/calendar.ics`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-subscription-status"), "active");
    const ics = await response.text();
    assert.match(ics, /UID:evt_subscription_test@kgmu-calendar/);
    assert.match(ics, /DTSTART:20260914T090000/);
    assert.match(ics, /SEQUENCE:0/);
    assert.doesNotMatch(ics, /TZID=/);
  },
));
