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

test("checkout validates selection and creates payment", () => withServer(async (base) => {
  const paymentServer = http.createServer(createHandler({
    store,
    config: { ...config, offerExpiresAt: "2999-08-31T23:59:59+03:00" },
    payments: {
      enabled: true,
      create: async ({ group, email }) => ({ orderId: "o".repeat(32), confirmationUrl: `https://pay.test/${group}/${email}` }),
    },
  }));
  await new Promise((resolve) => paymentServer.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${paymentServer.address().port}/api/v1/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ faculty: "pediatrics", course: 1, group: "132", email: "Student@example.com" }),
    });
    assert.equal(response.status, 201);
    assert.match((await response.json()).confirmationUrl, /student@example.com$/);
  } finally {
    await new Promise((resolve) => paymentServer.close(resolve));
  }
}));

test("order endpoints pass the private access token and reject missing ownership", async () => {
  const protectedServer = http.createServer(createHandler({
    store,
    config,
    payments: {
      enabled: true,
      getOrder: async (orderId, { accessToken }) => {
        if (accessToken !== "a".repeat(43)) {
          const error = new Error("denied");
          error.code = "order_forbidden";
          throw error;
        }
        return { orderId, status: "succeeded", group: "132" };
      },
      rotateSubscription: async (orderId, accessToken) => {
        if (accessToken !== "a".repeat(43)) {
          const error = new Error("denied");
          error.code = "order_forbidden";
          throw error;
        }
        return { orderId, status: "succeeded", group: "132", subscriptionUrl: "https://new.test/calendar.ics" };
      },
    },
  }));
  await new Promise((resolve) => protectedServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${protectedServer.address().port}`;
  const orderId = "o".repeat(32);
  try {
    assert.equal((await fetch(`${base}/api/v1/orders/${orderId}`)).status, 403);
    const orderResponse = await fetch(`${base}/api/v1/orders/${orderId}`, {
      headers: { "X-Order-Token": "a".repeat(43) },
    });
    assert.equal(orderResponse.status, 200);
    const resetResponse = await fetch(`${base}/api/v1/orders/${orderId}/subscription/reset`, {
      method: "POST",
      headers: { "X-Order-Token": "a".repeat(43) },
    });
    assert.equal(resetResponse.status, 200);
    assert.equal((await resetResponse.json()).subscriptionUrl, "https://new.test/calendar.ics");
  } finally {
    await new Promise((resolve) => protectedServer.close(resolve));
  }
});

test("calendar access is monitored without blocking and admin actions require a separate token", async () => {
  const tokenHash = "f".repeat(64);
  let observed = false;
  let revoked = false;
  const monitoredStore = {
    ...store,
    recordSubscriptionAccess: async (_token, _subscription, observation) => {
      observed = /^[a-f0-9]{64}$/.test(observation.fingerprint);
    },
    listSubscriptionAccess: async () => [{
      version: 1,
      tokenHash,
      orderId: "o".repeat(32),
      group: "132",
      status: "active",
      suspicious: true,
      sourceCount: 8,
      totalRequests: 10,
      sources: [{ fingerprint: "private" }],
      lastSeenAt: "2026-08-09T12:00:00.000Z",
    }],
    revokeSubscriptionByHash: async (hash) => {
      revoked = hash === tokenHash;
      return { group: "132", status: "revoked" };
    },
  };
  const monitoredConfig = {
    ...config,
    subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
    adminToken: "a-separate-admin-token-that-is-long-enough",
  };
  const server = http.createServer(createHandler({ store: monitoredStore, config: monitoredConfig }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const calendar = await fetch(`${base}/api/v1/subscriptions/${"a".repeat(43)}/calendar.ics`, {
      headers: { "user-agent": "CalendarAgent Apple" },
    });
    assert.equal(calendar.status, 200);
    assert.equal(observed, true);
    assert.equal((await fetch(`${base}/api/v1/admin/subscriptions`)).status, 403);
    const listResponse = await fetch(`${base}/api/v1/admin/subscriptions`, {
      headers: { "X-Admin-Token": monitoredConfig.adminToken },
    });
    assert.equal(listResponse.status, 200);
    const record = (await listResponse.json()).subscriptions[0];
    assert.equal(record.suspicious, true);
    assert.equal("sources" in record, false);
    const revokeResponse = await fetch(`${base}/api/v1/admin/subscriptions/${tokenHash}/revoke`, {
      method: "POST",
      headers: { "X-Admin-Token": monitoredConfig.adminToken },
    });
    assert.equal(revokeResponse.status, 200);
    assert.equal(revoked, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
