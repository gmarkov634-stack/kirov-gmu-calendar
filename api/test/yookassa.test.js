import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { YooKassaService } from "../src/yookassa.js";

const config = {
  yookassaShopId: "test-shop",
  yookassaSecretKey: "test-key",
  yookassaTestMode: true,
  subscriptionSigningSecret: "a-long-test-signing-secret-32-bytes-minimum",
  universitySiteUrls: {
    kgmu: "https://kgmu.example.test/",
    omgmu: "https://omgmu.example.test/",
    pgmu: "https://pgmu.example.test/",
  },
  publicApiUrl: "https://api.example.test",
  offerAcademicYear: "2026/27",
  offerSemester: 1,
  offers: {
    semester: { id: "semester", price: "299.00" },
    year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
  },
  yookassaSendReceipt: true,
  receiptVatCode: 1,
};

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
  events: [
    {
      id: "class-1",
      start: "2026-12-18T02:30:00.000Z",
      end: "2026-12-18T04:00:00.000Z",
      title: "Анатомия",
    },
    {
      id: "class-2",
      start: "2026-12-22T05:00:00.000Z",
      end: "2026-12-22T06:30:00.000Z",
      title: "Физиология",
    },
  ],
};

function memoryStore() {
  const orders = new Map();
  const subscriptions = new Map();
  return {
    orders,
    subscriptions,
    putOrder: async (id, value) => orders.set(id, structuredClone(value)),
    getOrder: async (id) => structuredClone(orders.get(id) || null),
    putSubscription: async (token, value) => subscriptions.set(token, structuredClone(value)),
    getSubscription: async (token) => structuredClone(subscriptions.get(token) || null),
  };
}

test("payment creation stores the complete university context and derives semester end from the last class", async () => {
  const store = memoryStore();
  let request;
  const service = new YooKassaService({ config, store, fetchFn: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "payment_12345678",
      status: "pending",
      test: true,
      confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });

  const result = await service.create({ email: "student@example.com", schedule });
  const order = store.orders.get(result.orderId);
  assert.equal(result.confirmationUrl, "https://yookassa.test/pay");
  assert.equal(order.version, 2);
  assert.equal(order.university, "omgmu");
  assert.equal(order.groupCode, "Л-402А");
  assert.equal(order.groupId, "omgmu:medicine:4:stream-2:Л-402А");
  assert.equal(order.plan, "semester");
  assert.equal(order.amount, "299.00");
  assert.equal(order.expiresAt, "2026-12-22T06:30:00.000Z");
  assert.equal(order.accessTokenHash, createHash("sha256").update(result.accessToken).digest("hex"));
  assert.equal(request.body.metadata.university, "omgmu");
  assert.equal(request.body.metadata.group_id, order.groupId);
  assert.equal(request.body.metadata.plan, "semester");
  assert.match(request.body.description, /ОмГМУ/);

  const returnUrl = new URL(request.body.confirmation.return_url);
  assert.equal(`${returnUrl.origin}${returnUrl.pathname}`, "https://omgmu.example.test/");
  const returnParams = new URLSearchParams(returnUrl.hash.slice(1));
  assert.equal(returnParams.get("order"), result.orderId);
  assert.equal(returnParams.get("access"), result.accessToken);
});

test("semester checkout is rejected when the official schedule has no class end", async () => {
  const store = memoryStore();
  let fetchCalled = false;
  const service = new YooKassaService({ config, store, fetchFn: async () => {
    fetchCalled = true;
    throw new Error("must not call YooKassa");
  } });
  await assert.rejects(
    service.create({ email: "student@example.com", schedule: { ...schedule, events: [] } }),
    (error) => error.code === "semester_end_not_found",
  );
  assert.equal(fetchCalled, false);
  assert.equal(store.orders.size, 0);
});

test("КГМУ payments return only to the configured КГМУ landing", async () => {
  const store = memoryStore();
  let request;
  const service = new YooKassaService({ config, store, fetchFn: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "payment_kgmu_123",
      status: "pending",
      test: true,
      confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const kgmu = {
    ...schedule,
    university: "kgmu",
    universityName: "КГМУ",
    group: { id: "kgmu:medicine:4:402", code: "402", displayName: "Группа 402" },
  };
  await service.create({ email: "student@example.com", schedule: kgmu });
  const returnUrl = new URL(request.body.confirmation.return_url);
  assert.equal(`${returnUrl.origin}${returnUrl.pathname}`, "https://kgmu.example.test/");
});

test("university checkout is rejected when its own landing URL is missing", async () => {
  const store = memoryStore();
  let fetchCalled = false;
  const service = new YooKassaService({
    config: {
      ...config,
      universitySiteUrls: { ...config.universitySiteUrls, omgmu: "" },
    },
    store,
    fetchFn: async () => {
      fetchCalled = true;
      throw new Error("must not call YooKassa");
    },
  });

  await assert.rejects(
    service.create({ email: "student@example.com", schedule }),
    /Site URL is not configured for omgmu/,
  );
  assert.equal(fetchCalled, false);
  assert.equal(store.orders.size, 0);
});

test("payments stay disabled without a shared PUBLIC_API_URL", () => {
  const service = new YooKassaService({ config: { ...config, publicApiUrl: "" }, store: memoryStore() });
  assert.equal(service.enabled, false);
});

test("archived schedules cannot be sold as semester or year plans", async () => {
  const archived = {
    ...schedule,
    university: "kgmu",
    universityName: "КГМУ",
    program: "pediatrics",
    course: 1,
    group: { id: "kgmu:pediatrics:1:132", code: "132", displayName: "Группа 132" },
    academicYear: "2025-2026",
    semester: 2,
  };
  for (const plan of ["semester", "year"]) {
    const store = memoryStore();
    let fetchCalled = false;
    const service = new YooKassaService({ config, store, fetchFn: async () => {
      fetchCalled = true;
      throw new Error("must not call YooKassa");
    } });
    await assert.rejects(
      service.create({ email: "student@example.com", schedule: archived, plan }),
      (error) => error.code === "schedule_period_not_for_sale",
    );
    assert.equal(fetchCalled, false);
    assert.equal(store.orders.size, 0);
  }
});

test("year plan charges 499 rubles and stores year access", async () => {
  const store = memoryStore();
  let request;
  const service = new YooKassaService({ config, store, fetchFn: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "payment_year_123",
      status: "pending",
      test: true,
      confirmation: { confirmation_url: "https://yookassa.test/pay" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  } });

  const result = await service.create({ email: "student@example.com", schedule, plan: "year" });
  const order = store.orders.get(result.orderId);
  assert.equal(order.plan, "year");
  assert.equal(order.amount, "499.00");
  assert.equal(order.expiresAt, "2027-08-31T23:59:59+03:00");
  assert.equal(request.body.amount.value, "499.00");
  assert.equal(request.body.metadata.plan, "year");
  assert.match(request.body.description, /учебный год/);
});

test("succeeded payment creates a version 2 subscription", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  await store.putOrder(orderId, {
    version: 2,
    orderId,
    status: "pending",
    paymentId: "payment_12345678",
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
    plan: "semester",
    expiresAt: "2026-12-22T06:30:00.000Z",
    amount: "299.00",
    currency: "RUB",
  });
  const payment = {
    id: "payment_12345678",
    status: "succeeded",
    paid: true,
    test: true,
    amount: { value: "299.00", currency: "RUB" },
    metadata: { order_id: orderId },
  };
  const service = new YooKassaService({ config, store, fetchFn: async () => new Response(JSON.stringify(payment), {
    status: 200,
    headers: { "content-type": "application/json" },
  }) });

  const first = await service.fulfillByPaymentId(payment.id);
  const second = await service.fulfillByPaymentId(payment.id);
  assert.equal(first.subscriptionUrl, second.subscriptionUrl);
  assert.equal(store.subscriptions.size, 1);
  const subscription = [...store.subscriptions.values()][0];
  assert.equal(subscription.version, 2);
  assert.equal(subscription.university, "omgmu");
  assert.equal(subscription.groupCode, "Л-402А");
  assert.equal(subscription.timezone, "Asia/Omsk");
  assert.equal(subscription.plan, "semester");
  assert.equal(subscription.expiresAt, "2026-12-22T06:30:00.000Z");
});

test("altered payment amount cannot issue a subscription", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  await store.putOrder(orderId, { orderId, paymentId: "payment_12345678", amount: "299.00", currency: "RUB" });
  const service = new YooKassaService({ config, store });
  await assert.rejects(service.fulfill({
    id: "payment_12345678",
    status: "succeeded",
    paid: true,
    test: true,
    amount: { value: "1.00", currency: "RUB" },
    metadata: { order_id: orderId },
  }), /amount/);
  assert.equal(store.subscriptions.size, 0);
});

test("protected order requires its access token", async () => {
  const store = memoryStore();
  const orderId = "o".repeat(32);
  const accessToken = "a".repeat(43);
  await store.putOrder(orderId, {
    orderId,
    status: "succeeded",
    university: "omgmu",
    program: "medicine",
    course: 4,
    stream: "2",
    groupCode: "Л-402А",
    groupId: "omgmu:medicine:4:stream-2:Л-402А",
    groupDisplayName: "Группа Л-402А",
    accessTokenHash: createHash("sha256").update(accessToken).digest("hex"),
    subscriptionUrl: "https://api.example.test/api/v1/subscriptions/" + "s".repeat(43) + "/calendar.ics",
  });
  const service = new YooKassaService({ config, store });
  await assert.rejects(service.getOrder(orderId, { reconcile: false }), /access denied/);
  const order = await service.getOrder(orderId, { reconcile: false, accessToken });
  assert.equal(order.university, "omgmu");
  assert.equal(order.groupCode, "Л-402А");
});
