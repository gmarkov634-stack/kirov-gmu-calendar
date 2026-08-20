import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { listUniversities } from "../src/universities/registry.mjs";

const ugmuGroupId = "ugmu:medicine:1:stream-1:ОЛД 101";
const ugmuSchedule = {
  version: 1,
  university: "ugmu",
  universityName: "УГМУ",
  program: "medicine",
  course: 1,
  stream: "1",
  group: {
    id: ugmuGroupId,
    code: "ОЛД 101",
    displayName: "Группа ОЛД 101",
  },
  timezone: "Asia/Yekaterinburg",
  academicYear: "2026/2027",
  semester: 1,
  sources: [{ url: "https://usma.ru/wp-content/uploads/2026/08/1OLD.pdf" }],
  events: [{
    id: "evt_ugmu_old101_0001",
    title: "ЛЕКЦ. ХИМИЯ",
    start: "2026-09-01T08:50:00+05:00",
    end: "2026-09-01T10:20:00+05:00",
    location: "Онлайн",
  }],
};

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function checkoutBody(university) {
  if (university === "ugmu") {
    return {
      university_id: "ugmu",
      program: "medicine",
      course: 1,
      stream: "1",
      groupCode: "ОЛД 101",
      groupId: ugmuGroupId,
      email: "student@example.com",
      plan: "semester",
    };
  }
  return {
    university_id: university,
    program: "medicine",
    course: 1,
    groupCode: "131",
    groupId: `${university}:medicine:1:131`,
    email: "student@example.com",
    plan: "semester",
  };
}

test("every registered tenant has an explicit checkout policy", () => {
  const config = loadConfig({});
  const registered = listUniversities().map((item) => item.id).sort();
  assert.deepEqual(registered, ["izhgmu", "kgmu", "omgmu", "ugmu"]);
  assert.deepEqual(Object.keys(config.universityAccess).sort(), registered);
  for (const university of registered) {
    assert.equal(Object.hasOwn(config.universityAccess[university], "checkoutEnabled"), true, university);
  }
});

test("dedicated UGMU flag opens only UGMU while legacy global sales stay off", () => {
  const config = loadConfig({ UGMU_SALES_ENABLED: "true" });
  assert.equal(config.globalCommercialSalesEnabled, false);
  assert.equal(config.ugmuSalesEnabled, true);
  assert.equal(config.commercialSalesEnabled, true, "shared payment route must be reachable for the dedicated tenant");
  assert.equal(config.universityAccess.ugmu.checkoutEnabled, true);
  assert.equal(config.universityAccess.kgmu.checkoutEnabled, false);
  assert.equal(config.universityAccess.omgmu.checkoutEnabled, false);
  assert.equal(config.universityAccess.izhgmu.checkoutEnabled, false);
});

test("legacy global gate preserves KGMU and OmGMU while it cannot open UGMU", () => {
  const config = loadConfig({ COMMERCIAL_SALES_ENABLED: "true" });
  assert.equal(config.globalCommercialSalesEnabled, true);
  assert.equal(config.ugmuSalesEnabled, false);
  assert.equal(config.commercialSalesEnabled, true);
  assert.equal(config.universityAccess.kgmu.checkoutEnabled, true);
  assert.equal(config.universityAccess.omgmu.checkoutEnabled, true);
  assert.equal(config.universityAccess.izhgmu.checkoutEnabled, false);
  assert.equal(config.universityAccess.ugmu.checkoutEnabled, false);
});

test("UGMU dedicated flag is exact and does not open public/trials/paid redirect", () => {
  for (const value of [undefined, "false", "TRUE", "1", "yes"]) {
    const config = loadConfig({ ...(value == null ? {} : { UGMU_SALES_ENABLED: value }), UGMU_SITE_URL: "https://must-stay-closed.example" });
    assert.equal(config.ugmuSalesEnabled, false, String(value));
    assert.equal(config.universityAccess.ugmu.checkoutEnabled, false, String(value));
  }
  const open = loadConfig({
    UGMU_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    TRIALS_ENABLED: "true",
    UGMU_SITE_URL: "https://must-stay-closed.example",
  });
  assert.equal(open.universityAccess.ugmu.checkoutEnabled, true);
  assert.equal(open.universityAccess.ugmu.publicEndpointsEnabled, false);
  assert.equal(open.universityAccess.ugmu.trialsEnabled, false);
  assert.equal(open.universitySiteUrls.ugmu, "");
});

test("UGMU checkout can pass its tenant gate with global sales off", async () => {
  let storeCalls = 0;
  let paymentCalls = 0;
  const config = loadConfig({ UGMU_SALES_ENABLED: "true" });
  const store = {
    getSchedule: async () => {
      storeCalls += 1;
      return ugmuSchedule;
    },
  };
  const payments = {
    enabled: true,
    create: async () => {
      paymentCalls += 1;
      return { orderId: "o".repeat(32), confirmationUrl: "https://pay.test/ugmu" };
    },
  };

  await withServer(createHandler({ store, config, payments }), async (origin) => {
    const response = await fetch(`${origin}/api/v2/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(checkoutBody("ugmu")),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).confirmationUrl, "https://pay.test/ugmu");
  });

  assert.equal(storeCalls, 1);
  assert.equal(paymentCalls, 1);
});

test("UGMU-only sales mode blocks every non-target tenant before storage/payment", async () => {
  const config = loadConfig({ UGMU_SALES_ENABLED: "true" });
  let storeCalls = 0;
  let paymentCalls = 0;
  const store = {
    getSchedule: async () => {
      storeCalls += 1;
      throw new Error("non-target store must not be reached");
    },
  };
  const payments = {
    enabled: true,
    create: async () => {
      paymentCalls += 1;
      throw new Error("non-target payment provider must not be reached");
    },
  };

  await withServer(createHandler({ store, config, payments }), async (origin) => {
    for (const university of ["kgmu", "omgmu", "izhgmu"]) {
      const response = await fetch(`${origin}/api/v2/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkoutBody(university)),
      });
      assert.equal(response.status, 409, university);
      assert.deepEqual(await response.json(), { error: "university_sales_not_open" }, university);
    }
  });

  assert.equal(storeCalls, 0);
  assert.equal(paymentCalls, 0);
});
