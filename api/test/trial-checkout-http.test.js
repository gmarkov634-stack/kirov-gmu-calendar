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

const schedule = {
  version: 1,
  university: "kgmu",
  universityName: "КГМУ",
  program: "pediatrics",
  course: 1,
  stream: null,
  group: { id: "kgmu:pediatrics:1:131", code: "131", displayName: "Группа 131" },
  timezone: "Europe/Moscow",
  academicYear: "2026-2027",
  semester: 1,
  events: [{
    id: "class-1",
    start: "2026-12-20T09:00:00+03:00",
    end: "2026-12-20T10:30:00+03:00",
    title: "Педиатрия",
  }],
};

const config = {
  commercialSalesEnabled: true,
  trialsEnabled: true,
  yookassaTestMode: true,
  allowedOrigins: [],
  subscriptionSigningSecret: "s".repeat(32),
  universitySiteUrls: { kgmu: "https://kgmu.example.test" },
};

test("meta exposes independent trial gate and checkout forwards conversion id", async () => {
  const calls = [];
  const payments = {
    enabled: true,
    async create(value) {
      calls.push(value);
      return {
        orderId: "o".repeat(32),
        accessToken: "a".repeat(43),
        confirmationUrl: "https://yookassa.test/pay",
      };
    },
  };
  const store = {
    async getSchedule() { return schedule; },
  };
  const handler = createHandler({ store, config, payments });

  await withServer(handler, async (base) => {
    const metaResponse = await fetch(`${base}/api/v2/meta`);
    assert.equal(metaResponse.status, 200);
    const meta = await metaResponse.json();
    assert.equal(meta.sales, "open");
    assert.equal(meta.trials, "open");
    assert.equal(meta.paymentMode, "test");

    const conversionId = "c".repeat(43);
    const checkoutResponse = await fetch(`${base}/api/v2/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "student@example.com",
        university: "kgmu",
        program: "pediatrics",
        course: 1,
        groupCode: "131",
        groupId: "kgmu:pediatrics:1:131",
        plan: "semester",
        conversionId,
      }),
    });
    assert.equal(checkoutResponse.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].conversionId, conversionId);
    assert.equal(calls[0].plan, "semester");
  });
});

test("trial gate defaults closed independently from sales", async () => {
  const handler = createHandler({
    store: {},
    config: { ...config, trialsEnabled: undefined },
    payments: { enabled: false },
  });
  await withServer(handler, async (base) => {
    const meta = await (await fetch(`${base}/api/v2/meta`)).json();
    assert.equal(meta.sales, "open");
    assert.equal(meta.trials, "closed");
  });
});
