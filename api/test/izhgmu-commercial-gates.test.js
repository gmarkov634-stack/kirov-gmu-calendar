import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { TrialService } from "../src/trial-service.js";
import { YooKassaService } from "../src/yookassa.js";

const izhSchedule = {
  version: 1,
  university: "izhgmu",
  universityName: "ИжГМУ",
  program: "medicine",
  course: 1,
  group: {
    id: "izhgmu:medicine:1:101",
    code: "101",
    displayName: "Группа 101",
  },
  timezone: "Europe/Samara",
  academicYear: "2026/2027",
  semester: 1,
  events: [],
};

test("IzhGMU trial gate stops before schedule lookup or entitlement writes", async () => {
  let scheduleReads = 0;
  let writes = 0;
  const service = new TrialService({
    config: {
      trialsEnabled: true,
      offerAcademicYear: "2026/27",
      offerSemester: 1,
      publicApiUrl: "https://api.example.test",
      universitySiteUrls: { izhgmu: "https://example.test/izhgmu" },
    },
    store: {
      async getSchedule() { scheduleReads += 1; return izhSchedule; },
      async putTrialConversion() { writes += 1; },
      async putSubscription() { writes += 1; },
    },
  });

  await assert.rejects(
    service.create({
      university: "izhgmu",
      program: "medicine",
      course: 1,
      groupId: izhSchedule.group.id,
      groupCode: "101",
    }),
    (error) => error?.code === "university_trials_not_open",
  );
  assert.equal(scheduleReads, 0);
  assert.equal(writes, 0);
});

test("IzhGMU paid redirect provisioning stays hard closed before order/provider calls", async () => {
  const config = loadConfig({
    IZHGMU_SITE_URL: "https://should-not-open.example/izhgmu",
    PUBLIC_API_URL: "https://api.example.test",
    YOOKASSA_SHOP_ID: "test-shop",
    YOOKASSA_SECRET_KEY: "test-secret",
    YOOKASSA_TEST_MODE: "true",
    SUBSCRIPTION_SIGNING_SECRET: "x".repeat(32),
    OFFER_ACADEMIC_YEAR: "2026/27",
    OFFER_SEMESTER: "1",
  });
  assert.equal(config.universitySiteUrls.izhgmu, "");

  let orderWrites = 0;
  let providerCalls = 0;
  const service = new YooKassaService({
    config,
    store: {
      async putOrder() { orderWrites += 1; },
    },
    async fetchFn() {
      providerCalls += 1;
      throw new Error("provider must not be called");
    },
  });

  await assert.rejects(
    service.create({ email: "student@example.test", schedule: izhSchedule, plan: "semester" }),
    /Site URL is not configured for izhgmu/,
  );
  assert.equal(orderWrites, 0);
  assert.equal(providerCalls, 0);
});

test("IzhGMU landing reads live catalog and contains no trial/payment call", async () => {
  const script = await fs.readFile(new URL("../../izhgmu/preview-izh.js", import.meta.url), "utf8");
  assert.match(script, /\/api\/v2\/catalog\/\$\{UNIVERSITY\}\/programs/);
  assert.match(script, /\/groups/);
  assert.match(script, /catalog\.commercial === 'open'/);
  assert.doesNotMatch(script, /\/api\/v2\/payments/);
  assert.doesNotMatch(script, /\/api\/v2\/trials/);
  assert.doesNotMatch(script, /groups\s*=\s*\[/);
});
