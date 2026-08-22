import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createHandler } from "../src/app.js";
import {
  UGMU_SELLABLE_GROUPS,
  UGMU_SELLABLE_SCOPES,
  ugmuSellableContextAllowed,
} from "../src/ugmu-access-catalog.mjs";

function canonicalSchedule(group) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: group.university,
      faculty_code: group.program,
      course: group.course,
      stream: group.stream,
      group: group.groupCode,
      group_id: group.groupId,
      group_display_name: `Группа ${group.groupCode}`,
      academic_year: "2026/2027",
      semester: "autumn",
      timezone: "Asia/Yekaterinburg",
      schedule_version_id: `test-${group.groupCode}`,
    },
    events: [],
  };
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function checkoutBody(group) {
  return {
    university_id: group.university,
    program: group.program,
    course: group.course,
    stream: group.stream,
    groupCode: group.groupCode,
    groupId: group.groupId,
    academicYear: "2026/2027",
    semester: 1,
    email: "student@example.com",
    plan: "semester",
  };
}

test("UGMU sellable catalog is data-driven and currently contains all 50 staged groups", () => {
  assert.equal(UGMU_SELLABLE_SCOPES.length, 1);
  assert.equal(UGMU_SELLABLE_SCOPES[0].program, "medicine");
  assert.equal(UGMU_SELLABLE_SCOPES[0].course, 1);
  assert.equal(UGMU_SELLABLE_GROUPS.length, 50);
  assert.deepEqual(
    Object.fromEntries(["1", "2", "3", "4"].map((stream) => [
      stream,
      UGMU_SELLABLE_GROUPS.filter((group) => group.stream === stream).length,
    ])),
    { 1: 12, 2: 12, 3: 12, 4: 14 },
  );

  for (const group of UGMU_SELLABLE_GROUPS) {
    assert.equal(ugmuSellableContextAllowed(checkoutBody(group)), true, group.groupCode);
  }
});

test("checkout reaches the payment layer for every staged UGMU group without external payment network", async () => {
  const scheduleReads = [];
  const paymentCreates = [];
  const byId = new Map(UGMU_SELLABLE_GROUPS.map((group) => [group.groupId, group]));
  const store = {
    async getSchedule(context) {
      scheduleReads.push(context.groupId);
      const group = byId.get(context.groupId);
      return group ? canonicalSchedule(group) : null;
    },
  };
  const payments = {
    enabled: true,
    async create({ schedule, plan, email }) {
      paymentCreates.push({ groupId: schedule.schedule.group_id, plan, email });
      return { confirmationUrl: "https://payments.example/confirm" };
    },
  };
  const config = {
    commercialSalesEnabled: true,
    allowedOrigins: [],
    universityAccess: {
      ugmu: {
        apiRoutingEnabled: true,
        checkoutEnabled: true,
        publicEndpointsEnabled: false,
        trialsEnabled: false,
      },
    },
  };

  await withServer(createHandler({ store, config, payments }), async (origin) => {
    for (const group of UGMU_SELLABLE_GROUPS) {
      const response = await fetch(`${origin}/api/v2/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkoutBody(group)),
      });
      assert.equal(response.status, 201, group.groupCode);
      assert.equal((await response.json()).confirmationUrl, "https://payments.example/confirm");
    }

    const beforeInvalid = scheduleReads.length;
    const invalid = await fetch(`${origin}/api/v2/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...checkoutBody(UGMU_SELLABLE_GROUPS.at(-1)),
        groupCode: "ОЛД 151",
        groupId: "ugmu:medicine:1:stream-4:ОЛД 151",
      }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "invalid_checkout" });
    assert.equal(scheduleReads.length, beforeInvalid, "invalid scope must fail before storage read");
  });

  assert.equal(scheduleReads.length, 50);
  assert.equal(new Set(scheduleReads).size, 50);
  assert.equal(paymentCreates.length, 50);
  assert.equal(new Set(paymentCreates.map((item) => item.groupId)).size, 50);
});
