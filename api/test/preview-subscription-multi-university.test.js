import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createPreviewSubscriptionHandler } from "../src/preview-subscription-handler.js";

const ADMIN = "a".repeat(32);

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, body) {
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": ADMIN },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function handlerFor(schedule, { onGet, onPut } = {}) {
  return createPreviewSubscriptionHandler({
    config: {
      adminToken: ADMIN,
      publicApiUrl: "https://calendar.example.test",
    },
    store: {
      async getSchedule(context) {
        onGet?.(context);
        return schedule;
      },
      async putSubscription(token, subscription) {
        onPut?.(token, subscription);
      },
    },
  });
}

test("legacy KГМУ preview remains backward compatible without explicit groupId", () => {
  let requested;
  let stored;
  const schedule = {
    version: 1,
    university: "kgmu",
    universityName: "КГМУ",
    program: "medicine",
    course: 4,
    group: { id: "kgmu:medicine:4:401", code: "401", displayName: "Группа 401" },
    timezone: "Europe/Moscow",
    academicYear: "2025/2026",
    semester: 2,
    events: [],
  };
  return withServer(handlerFor(schedule, {
    onGet: (value) => { requested = value; },
    onPut: (_token, value) => { stored = value; },
  }), async (base) => {
    const result = await post(base, {
      university: "kgmu",
      program: "medicine",
      course: 4,
      groupCode: "401",
      academicYear: "2025/2026",
      semester: 2,
      days: 1,
    });
    assert.equal(result.response.status, 201);
    assert.equal(requested.groupId, "kgmu:medicine:4:401");
    assert.equal(result.body.groupId, "kgmu:medicine:4:401");
    assert.equal(stored.preview, true);
  });
});

test("ОмГМУ preview uses exact published groupId and stream", () => {
  let requested;
  let stored;
  const groupId = "omgmu:medicine-international:2:stream-1:2101";
  const schedule = {
    version: 1,
    university: "omgmu",
    universityName: "ОмГМУ",
    program: "medicine-international",
    course: 2,
    stream: "1",
    group: { id: groupId, code: "2101", displayName: "Группа 2101" },
    timezone: "Asia/Omsk",
    academicYear: "2025/2026",
    semester: 2,
    events: [],
  };
  return withServer(handlerFor(schedule, {
    onGet: (value) => { requested = value; },
    onPut: (_token, value) => { stored = value; },
  }), async (base) => {
    const result = await post(base, {
      university: "omgmu",
      program: "medicine-international",
      course: 2,
      stream: "1",
      groupCode: "2101",
      groupId,
      academicYear: "2025/2026",
      semester: 2,
      days: 1,
    });
    assert.equal(result.response.status, 201);
    assert.equal(requested.groupId, groupId);
    assert.equal(requested.stream, "1");
    assert.equal(result.body.university, "omgmu");
    assert.equal(result.body.stream, "1");
    assert.equal(result.body.groupId, groupId);
    assert.equal(stored.groupId, groupId);
    assert.equal(stored.stream, "1");
    assert.equal(stored.preview, true);
    assert.match(result.body.subscriptionUrl, /^https:\/\/calendar\.example\.test\/api\/v1\/subscriptions\/[A-Za-z0-9_-]{43}\/calendar\.ics$/);
  });
});

test("non-KГМУ preview requires authoritative groupId", () => withServer(handlerFor(null), async (base) => {
  const result = await post(base, {
    university: "omgmu",
    program: "medicine-international",
    course: 2,
    stream: "1",
    groupCode: "2101",
    academicYear: "2025/2026",
    semester: 2,
  });
  assert.equal(result.response.status, 400);
  assert.deepEqual(result.body, { error: "invalid_preview_context" });
}));

test("preview rejects a loaded schedule whose exact identity differs", () => {
  const requestedGroupId = "omgmu:medicine-international:2:stream-1:2101";
  const wrongSchedule = {
    version: 1,
    university: "omgmu",
    universityName: "ОмГМУ",
    program: "medicine-international",
    course: 2,
    stream: "2",
    group: { id: "omgmu:medicine-international:2:stream-2:2101", code: "2101", displayName: "Группа 2101" },
    timezone: "Asia/Omsk",
    academicYear: "2025/2026",
    semester: 2,
    events: [],
  };
  return withServer(handlerFor(wrongSchedule), async (base) => {
    const result = await post(base, {
      university: "omgmu",
      program: "medicine-international",
      course: 2,
      stream: "1",
      groupCode: "2101",
      groupId: requestedGroupId,
      academicYear: "2025/2026",
      semester: 2,
    });
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.body, { error: "preview_context_mismatch" });
  });
});
