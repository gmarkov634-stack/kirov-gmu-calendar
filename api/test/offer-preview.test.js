import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createOfferCatalogHandler } from "../src/offer-catalog.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function event(id, date, title, index) {
  return {
    schema_version: "1.0",
    system: {
      event_id: id,
      schedule_version_id: "ver_preview",
      fingerprint: `sha256:${String(index).padStart(64, "a").slice(-64)}`,
      revision: 1,
      created_at: "2026-08-15T08:00:00.000Z",
      updated_at: "2026-08-15T08:00:00.000Z",
    },
    timing: { date, start_time: "09:00", end_time: "10:30", all_day: false, time_mode: "floating" },
    lesson: {
      discipline: { raw: title, normalized: title },
      type: { raw: "Практика", code: "practice" },
      locations: ["ауд. 301"],
    },
    derived: { sequence: { index, total: 12, bucket: "class" } },
    calendar: { title, description: `${index} из 12`, location: "ауд. 301" },
    source: { raw_text: "must never be exposed" },
  };
}

const schedule = {
  schema_version: "1.0",
  schedule: {
    university_code: "kgmu",
    academic_year: "2026/2027",
    semester: "autumn",
    faculty_code: "pediatrics",
    course: 1,
    group: "131",
    group_id: "kgmu:pediatrics:1:131",
    timezone: "Europe/Moscow",
    period: { start_date: "2026-09-01", end_date: "2026-12-31", week1_start_date: "2026-08-31" },
    schedule_version_id: "ver_preview",
    content_fingerprint: `sha256:${"b".repeat(64)}`,
    version_created_at: "2026-08-15T08:00:00.000Z",
  },
  events: [
    event("past", "2026-08-10", "Прошедшее занятие", 1),
    event("one", "2026-09-01", "Педиатрия", 2),
    event("two", "2026-09-02", "Биохимия", 3),
    event("three", "2026-09-03", "Гистология", 4),
    event("four", "2026-09-04", "Анатомия", 5),
    event("five", "2026-09-05", "Физиология", 6),
  ],
};

test("group preview exposes at most four upcoming safe event summaries from an offered group", () => {
  const scheduleCalls = [];
  const handler = createOfferCatalogHandler({
    config: {
      allowedOrigin: "https://example.test",
      offerAcademicYear: "2026/27",
      offerSemester: 1,
    },
    now: () => new Date("2026-08-15T08:00:00.000Z"),
    store: {
      async listScheduleGroups() {
        return [{ groupId: "kgmu:pediatrics:1:131", groupCode: "131", displayName: "Группа 131" }];
      },
      async getSchedule(input) {
        scheduleCalls.push(input);
        return schedule;
      },
    },
  });

  return withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v2/catalog/kgmu/pediatrics/1/131/preview`, {
      headers: { Origin: "https://example.test" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    const body = await response.json();
    assert.equal(body.group.groupCode, "131");
    assert.equal(body.events.length, 4);
    assert.deepEqual(body.events.map((item) => item.title), ["Педиатрия", "Биохимия", "Гистология", "Анатомия"]);
    assert.deepEqual(body.events[0], {
      date: "2026-09-01",
      startTime: "09:00",
      endTime: "10:30",
      allDay: false,
      title: "Педиатрия",
      type: "Практика",
      location: "ауд. 301",
      sequence: "2 из 12",
    });
    assert.equal(JSON.stringify(body).includes("must never be exposed"), false);
    assert.equal(scheduleCalls.length, 1);
    assert.equal(scheduleCalls[0].groupId, "kgmu:pediatrics:1:131");
  });
});

test("group preview is fail-closed for a group outside the published offer catalog", () => withServer(
  createOfferCatalogHandler({
    config: { offerAcademicYear: "2026/27", offerSemester: 1 },
    store: {
      async listScheduleGroups() { return []; },
      async getSchedule() { throw new Error("must not be called"); },
    },
  }),
  async (base) => {
    const response = await fetch(`${base}/api/v2/catalog/kgmu/pediatrics/1/999/preview`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "offer_not_found" });
  },
));
