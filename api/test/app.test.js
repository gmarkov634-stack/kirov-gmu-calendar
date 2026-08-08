import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createHandler } from "../src/app.js";

const config = {
  allowedOrigin: "https://gmarkov634-stack.github.io",
  publicSiteUrl: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/",
  enablePublicEndpoints: true,
};
const store = {
  listGroups: () => [{ group: "132", faculty: "pediatrics", course: 1 }],
  get: async (group) => group === "132" ? {
    group,
    faculty: "pediatrics",
    course: 1,
    academicYear: "2025-2026",
    semester: 2,
    events: [],
  } : null,
  getSubscription: async (token) => token === "a".repeat(43) ? {
    version: 1,
    status: "active",
    group: "132",
    faculty: "pediatrics",
    course: 1,
    academicYear: "2025-2026",
    semester: 2,
    expiresAt: "2999-07-01T00:00:00+03:00",
  } : token === "e".repeat(43) ? {
    version: 1,
    status: "active",
    group: "132",
    faculty: "pediatrics",
    course: 1,
    academicYear: "2025-2026",
    semester: 2,
    expiresAt: "2020-07-01T00:00:00+03:00",
  } : null,
};

async function withServer(callback) {
  const server = http.createServer(createHandler({ store, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint responds", () => withServer(async (base) => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "kgmu-calendar-api" });
}));

test("schedule endpoint returns configured group", () => withServer(async (base) => {
  const response = await fetch(`${base}/api/v1/groups/132/schedule`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.group, "132");
  assert.match(body.disclaimer, /официальному расписанию/);
}));

test("active subscription returns its semester calendar", () => withServer(async (base) => {
  const response = await fetch(`${base}/api/v1/subscriptions/${"a".repeat(43)}/calendar.ics`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-subscription-status"), "active");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(await response.text(), /X-WR-CALNAME:КГМУ · группа 132/);
}));

test("expired subscription returns an empty calendar to remove old events", () => withServer(async (base) => {
  const response = await fetch(`${base}/api/v1/subscriptions/${"e".repeat(43)}/calendar.ics`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-subscription-status"), "expired");
  const calendar = await response.text();
  assert.match(calendar, /BEGIN:VCALENDAR/);
  assert.doesNotMatch(calendar, /BEGIN:VEVENT/);
}));

test("public schedule endpoints can be disabled", async () => {
  const server = http.createServer(createHandler({ store, config: { ...config, enablePublicEndpoints: false } }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/groups/132/schedule`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
