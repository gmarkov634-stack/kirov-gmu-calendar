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

const token = "s".repeat(43);
const schedule = {
  version: 1,
  university: "kgmu",
  universityName: "КГМУ",
  program: "pediatrics",
  course: 1,
  group: { id: "kgmu:pediatrics:1:132", code: "132", displayName: "Группа 132" },
  timezone: "Europe/Moscow",
  academicYear: "2026/2027",
  semester: 2,
  sources: [],
  events: [],
};

function subscription(plan) {
  return {
    version: 2,
    status: "active",
    university: "kgmu",
    universityName: "КГМУ",
    program: "pediatrics",
    course: 1,
    stream: null,
    groupCode: "132",
    groupId: "kgmu:pediatrics:1:132",
    groupDisplayName: "Группа 132",
    timezone: "Europe/Moscow",
    academicYear: "2026/2027",
    semester: 1,
    plan,
    expiresAt: "2027-08-31T23:59:59+03:00",
    orderId: "o".repeat(32),
    paymentId: "payment_12345678",
    createdAt: "2026-08-10T00:00:00.000Z",
  };
}

const config = {
  publicSiteUrl: "https://kgmu.example.test/",
  universitySiteUrls: { kgmu: "https://kgmu.example.test/" },
  enablePublicEndpoints: false,
};

test("year subscription follows the next semester within the same academic year", () => withServer(
  createHandler({
    store: {
      getSubscription: async () => subscription("year"),
      getSchedule: async () => schedule,
    },
    config,
  }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/subscriptions/${token}/calendar.ics`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-subscription-status"), "active");
    assert.match(await response.text(), /X-WR-CALNAME:КГМУ/);
  },
));

test("semester subscription stays bound to the purchased semester", () => withServer(
  createHandler({
    store: {
      getSubscription: async () => subscription("semester"),
      getSchedule: async () => schedule,
    },
    config,
  }),
  async (base) => {
    const response = await fetch(`${base}/api/v1/subscriptions/${token}/calendar.ics`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "subscription_unavailable" });
  },
));
