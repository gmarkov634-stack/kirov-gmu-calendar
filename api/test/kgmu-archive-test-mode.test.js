import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { kgmuArchiveTestActive } from "../src/archive-test-mode.js";
import { ArchiveTestMultiUniversityStore } from "../src/archive-test-store.js";
import { ArchiveTestYooKassaService } from "../src/archive-test-yookassa.js";
import { scheduleStorageKey } from "../src/order-context.js";

const archiveSchedule = {
  version: 1,
  university: "kgmu",
  universityName: "КГМУ",
  program: "pediatrics",
  course: 1,
  group: {
    id: "kgmu:pediatrics:1:132",
    code: "132",
    displayName: "Группа 132",
  },
  timezone: "Europe/Moscow",
  academicYear: "2025/2026",
  semester: 2,
  events: [{
    id: "archive-event",
    title: "Гистология",
    start: "2026-05-25T10:45:00.000Z",
    end: "2026-05-25T12:15:00.000Z",
  }],
};

function archiveConfig(extra = {}) {
  return {
    yookassaTestMode: true,
    kgmuArchiveTest: {
      enabled: true,
      academicYear: "2025/2026",
      semester: 2,
    },
    offerAcademicYear: "2026/27",
    offerSemester: 1,
    yookassaShopId: "1259975",
    yookassaSecretKey: "test-secret",
    subscriptionSigningSecret: "s".repeat(64),
    publicApiUrl: "https://student-calendar-api.containerapps.ru",
    universitySiteUrls: { kgmu: "https://example.test" },
    offers: {
      semester: { id: "semester", price: "299.00" },
      year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
    },
    yookassaSendReceipt: false,
    receiptVatCode: 1,
    ...extra,
  };
}

test("archive test mode cannot become active outside YooKassa test mode", () => {
  const config = loadConfig({
    KGMU_ARCHIVE_TEST_MODE: "true",
    KGMU_ARCHIVE_TEST_ACADEMIC_YEAR: "2025/2026",
    KGMU_ARCHIVE_TEST_SEMESTER: "2",
    YOOKASSA_TEST_MODE: "false",
  });
  assert.equal(kgmuArchiveTestActive(config), false);
});

test("KGMU default schedule reads are redirected to archive 2025/26 only in test mode", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-archive-test-"));
  const config = {
    ...archiveConfig(),
    dataDir,
    cacheTtlMs: 1000,
    accessKeyId: "",
    secretAccessKey: "",
  };
  const key = scheduleStorageKey(archiveSchedule);
  const filename = path.join(dataDir, key);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(archiveSchedule));

  const store = new ArchiveTestMultiUniversityStore(config);
  const loaded = await store.getSchedule({
    university: "kgmu",
    program: "pediatrics",
    course: 1,
    groupId: "kgmu:pediatrics:1:132",
    groupCode: "132",
  });
  assert.equal(loaded.academicYear, "2025/2026");
  assert.equal(loaded.semester, 2);
});

test("archive semester can be purchased in YooKassa test shop without extending subscription access", async () => {
  const orders = new Map();
  const subscriptions = new Map();
  const store = {
    putOrder: async (id, value) => orders.set(id, structuredClone(value)),
    getOrder: async (id) => orders.get(id) || null,
    putSubscription: async (token, value) => subscriptions.set(token, structuredClone(value)),
    getSubscription: async (token) => subscriptions.get(token) || null,
  };
  let requestedBody = null;
  const fetchFn = async (_url, options) => {
    requestedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "320c74a8-000f-5000-b000-archive-test",
        status: "pending",
        paid: false,
        test: true,
        confirmation: { confirmation_url: "https://yookassa.test/confirm" },
      }),
    };
  };
  const service = new ArchiveTestYooKassaService({ config: archiveConfig(), store, fetchFn });
  const result = await service.create({
    email: "archive-test@example.com",
    schedule: archiveSchedule,
    plan: "semester",
  });
  const order = orders.get(result.orderId);
  assert.equal(result.confirmationUrl, "https://yookassa.test/confirm");
  assert.equal(requestedBody.amount.value, "299.00");
  assert.equal(order.academicYear, "2025/2026");
  assert.equal(order.semester, 2);
  assert.equal(order.expiresAt, "2026-05-25T12:15:00.000Z");
  assert.equal(order.archiveTest, undefined);
});

test("the same archive schedule is not saleable when YooKassa test mode is off", async () => {
  const store = {
    putOrder: async () => {},
    getOrder: async () => null,
  };
  const service = new ArchiveTestYooKassaService({
    config: archiveConfig({ yookassaTestMode: false }),
    store,
    fetchFn: async () => { throw new Error("network must not be called"); },
  });
  await assert.rejects(
    () => service.create({ email: "no@example.com", schedule: archiveSchedule, plan: "semester" }),
    /Published schedule is not for the period currently on sale/,
  );
});
