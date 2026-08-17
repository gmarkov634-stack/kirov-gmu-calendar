import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { TrialService } from "../src/trial-service.js";
import { isUniversityCommercialEnabled } from "../src/universities/registry.mjs";

function request(method, url, body) {
  const payload = body == null ? "" : JSON.stringify(body);
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
}

function response() {
  return {
    status: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(value = "") {
      this.body = value ? JSON.parse(value) : null;
    },
  };
}

const izhgmuContext = {
  university: "izhgmu",
  program: "medicine",
  course: 1,
  groupCode: "future-server-group",
  groupId: "izhgmu:medicine:1:future-server-group",
};

test("university commercial gate is independent from catalog and active states", () => {
  assert.equal(isUniversityCommercialEnabled("kgmu"), true);
  assert.equal(isUniversityCommercialEnabled("omgmu"), true);
  assert.equal(isUniversityCommercialEnabled("izhgmu"), false);
  assert.equal(isUniversityCommercialEnabled("unknown"), false);
});

test("IzhGMU trial is blocked before schedule lookup even when global trials are open", async () => {
  let scheduleLookups = 0;
  const service = new TrialService({
    config: {
      trialsEnabled: true,
      offerAcademicYear: "2026/27",
      offerSemester: 1,
      universitySiteUrls: { izhgmu: "https://example.invalid/izhgmu" },
      publicApiUrl: "https://api.example.invalid",
    },
    store: {
      async putTrialConversion() {},
      async getSchedule() {
        scheduleLookups += 1;
        return null;
      },
    },
  });

  await assert.rejects(
    service.create(izhgmuContext),
    (error) => error?.code === "university_commercial_not_open",
  );
  assert.equal(scheduleLookups, 0);
});

test("IzhGMU public checkout is blocked before storage and payment calls when global sales are open", async () => {
  let scheduleLookups = 0;
  let paymentCalls = 0;
  const handler = createHandler({
    config: {
      commercialSalesEnabled: true,
      trialsEnabled: true,
      yookassaTestMode: true,
      allowedOrigins: [],
      offers: {},
    },
    store: {
      async getSchedule() {
        scheduleLookups += 1;
        return null;
      },
    },
    payments: {
      enabled: true,
      async create() {
        paymentCalls += 1;
        throw new Error("must not be called");
      },
    },
  });
  const res = response();

  await handler(request("POST", "/api/v2/payments", {
    ...izhgmuContext,
    email: "student@example.com",
    plan: "semester",
  }), res);

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "university_commercial_not_open" });
  assert.equal(scheduleLookups, 0);
  assert.equal(paymentCalls, 0);
});

test("scoped meta exposes safe university commercial state without changing global gates", async () => {
  const handler = createHandler({
    config: {
      commercialSalesEnabled: true,
      trialsEnabled: true,
      yookassaTestMode: true,
      allowedOrigins: [],
      offers: { semester: { price: "299.00" } },
    },
    store: {},
    payments: { enabled: true },
  });
  const res = response();

  await handler(request("GET", "/api/v2/meta?university=izhgmu"), res);

  assert.equal(res.status, 200);
  assert.equal(res.body.sales, "open");
  assert.equal(res.body.trials, "open");
  assert.equal(res.body.university, "izhgmu");
  assert.equal(res.body.universityCommercial, "closed");
});

test("IZHGMU_SITE_URL is explicit and fail-closed by default", () => {
  const closed = loadConfig({});
  assert.equal(closed.universitySiteUrls.izhgmu, "");

  const configured = loadConfig({ IZHGMU_SITE_URL: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/izhgmu" });
  assert.equal(configured.universitySiteUrls.izhgmu, "https://gmarkov634-stack.github.io/kirov-gmu-calendar/izhgmu");
});