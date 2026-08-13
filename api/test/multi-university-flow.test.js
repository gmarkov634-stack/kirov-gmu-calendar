import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHandler } from "../src/app.js";
import { scheduleStorageKey } from "../src/order-context.js";
import { MultiUniversityStore } from "../src/university-store.js";

const schedule = {
  version: 1,
  university: "omgmu",
  universityName: "ОмГМУ",
  program: "medicine",
  course: 4,
  stream: "2",
  group: {
    id: "omgmu:medicine:4:stream-2:Л-402А",
    code: "Л-402А",
    displayName: "Группа Л-402А",
  },
  timezone: "Asia/Omsk",
  academicYear: "2026-2027",
  semester: 1,
  sources: [{ url: "https://omsk-osma.ru/files/test.pdf" }],
  events: [{
    id: "omgmu-l402a-20260901",
    title: "Внутренние болезни",
    start: "2026-09-01T02:00:00.000Z",
    end: "2026-09-01T03:30:00.000Z",
    location: "Омск",
  }],
};

const subscription = {
  version: 2,
  status: "active",
  university: "omgmu",
  universityName: "ОмГМУ",
  program: "medicine",
  course: 4,
  stream: "2",
  groupCode: "Л-402А",
  groupId: "omgmu:medicine:4:stream-2:Л-402А",
  groupDisplayName: "Группа Л-402А",
  timezone: "Asia/Omsk",
  academicYear: "2026-2027",
  semester: 1,
  expiresAt: "2027-07-01T00:00:00+06:00",
};

test("MultiUniversityStore reads the normalized university path", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "medical-calendar-"));
  const key = scheduleStorageKey(schedule);
  const filename = path.join(dataDir, key);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(schedule));

  const store = new MultiUniversityStore({ dataDir, cacheTtlMs: 1000 });
  const loaded = await store.getSchedule(subscription);
  assert.equal(loaded.group.code, "Л-402А");
  assert.equal(loaded.timezone, "Asia/Omsk");
});

test("version 2 ОмГМУ subscription returns its floating-time ICS calendar", async () => {
  const token = "a".repeat(43);
  const store = {
    getSubscription: async (value) => value === token ? subscription : null,
    getSchedule: async () => schedule,
  };
  const config = {
    allowedOrigin: "https://example.test",
    publicSiteUrl: "https://example.test/",
    enablePublicEndpoints: false,
    subscriptionSigningSecret: "",
  };
  const server = http.createServer(createHandler({ store, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/subscriptions/${token}/calendar.ics`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-subscription-status"), "active");
    assert.match(response.headers.get("content-disposition"), /omgmu-/);
    const calendar = await response.text();
    assert.match(calendar, /X-WR-CALNAME:ОмГМУ · Группа Л-402А/);
    assert.match(calendar, /DTSTART:20260901T080000/);
    assert.match(calendar, /DTEND:20260901T093000/);
    assert.doesNotMatch(calendar, /X-WR-TIMEZONE/);
    assert.doesNotMatch(calendar, /TZID=/);
    assert.doesNotMatch(calendar, /BEGIN:VTIMEZONE/);
    assert.match(calendar, /UID:omgmu-l402a-20260901@omgmu-calendar/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("checkout resolves arbitrary group codes through getSchedule", async () => {
  let receivedSchedule;
  const store = { getSchedule: async () => schedule };
  const payments = {
    enabled: true,
    create: async ({ email, schedule: selected }) => {
      receivedSchedule = selected;
      assert.equal(email, "student@example.com");
      return { orderId: "o".repeat(32), confirmationUrl: "https://pay.test" };
    },
  };
  const config = {
    allowedOrigin: "https://example.test",
    offerExpiresAt: "2999-08-31T23:59:59+06:00",
    commercialSalesEnabled: true,
  };
  const server = http.createServer(createHandler({ store, config, payments }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        university: "omgmu",
        program: "medicine",
        course: 4,
        stream: "2",
        groupCode: "Л-402А",
        groupId: "omgmu:medicine:4:stream-2:Л-402А",
        email: "Student@example.com",
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(receivedSchedule.group.code, "Л-402А");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
