import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHandler } from "../src/app.js";
import { createOfferCatalogHandler } from "../src/offer-catalog.js";
import { scheduleContext, scheduleStorageKey } from "../src/order-context.js";
import { MultiUniversityStore } from "../src/university-store.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const streamedSchedule = {
  version: 1,
  university: "omgmu",
  universityName: "ОмГМУ",
  program: "medicine-international",
  course: 2,
  stream: "1",
  group: {
    id: "omgmu:medicine-international:2:stream-1:2101",
    code: "2101",
    displayName: "Группа 2101",
  },
  timezone: "Asia/Omsk",
  academicYear: "2026/2027",
  semester: 1,
  events: [{ id: "e1", title: "Терапия", start: "2026-09-01T08:20:00", end: "2026-09-01T09:50:00" }],
};

test("OmGMU offer catalog preserves exact stream identity for published groups", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omgmu-commerce-"));
  const filename = path.join(dataDir, scheduleStorageKey(streamedSchedule));
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(streamedSchedule));

  const store = new MultiUniversityStore({
    dataDir,
    cacheTtlMs: 0,
    offerAcademicYear: "2026/27",
    offerSemester: 1,
  });

  const exact = scheduleContext({
    university: "omgmu",
    program: "medicine-international",
    course: 2,
    groupId: streamedSchedule.group.id,
    groupCode: "2101",
  });
  assert.equal(exact.groupId, streamedSchedule.group.id);

  const groups = await store.listScheduleGroups({
    university: "omgmu",
    program: "medicine-international",
    course: 2,
    academicYear: "2026/27",
    semester: 1,
  });
  assert.deepEqual(groups, [{
    groupId: streamedSchedule.group.id,
    groupCode: "2101",
    displayName: "Группа 2101",
    stream: "1",
  }]);

  const handler = createOfferCatalogHandler({
    store,
    config: { offerAcademicYear: "2026/27", offerSemester: 1 },
  });
  await withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v2/catalog/omgmu/medicine-international/2/groups`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.groups, [{
      groupId: streamedSchedule.group.id,
      groupCode: "2101",
      displayName: "Группа 2101",
      stream: "1",
    }]);
  });
});

test("public meta exposes only authoritative offer prices used by checkout", () => withServer(
  createHandler({
    store: {},
    config: {
      commercialSalesEnabled: false,
      trialsEnabled: false,
      yookassaTestMode: true,
      offers: {
        semester: { id: "semester", price: "299.00" },
        year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
      },
    },
  }),
  async (base) => {
    const response = await fetch(`${base}/api/v2/meta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sales, "closed");
    assert.equal(body.paymentMode, "test");
    assert.deepEqual(body.offers, {
      semester: { price: "299.00" },
      year: { price: "499.00" },
    });
    assert.equal(body.offers.semester.expiresAt, undefined);
  },
));

test("OmGMU landing derives sellable catalog and commercial state from API", async () => {
  const [app, config, siteIndex, publicIndex] = await Promise.all([
    fs.readFile(new URL("../../site/omgmu/app.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../../site/omgmu/config.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../../site/omgmu/index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../../omgmu/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(app, /\/api\/v2\/meta/);
  assert.match(app, /\/api\/v2\/catalog\/\$\{encodeURIComponent\(config\.university\)\}\/programs/);
  assert.match(app, /\/groups/);
  assert.match(app, /runtime\.sales === 'open'/);
  assert.match(app, /meta\.paymentMode/);
  assert.match(app, /meta\.offers\?\.\[config\.defaultPlan\]\?\.price/);
  assert.match(app, /stream: group\.stream \?\? null/);
  assert.match(app, /plan: config\.defaultPlan/);

  assert.doesNotMatch(config, /checkoutEnabled/);
  assert.doesNotMatch(config, /testMode/);
  assert.doesNotMatch(config, /priceRub/);
  assert.match(config, /defaultPlan: "semester"/);

  for (const html of [siteIndex, publicIndex]) {
    assert.doesNotMatch(html, /groups\.js/);
    assert.doesNotMatch(html, />490 ₽</);
    assert.doesNotMatch(html, /<span class="badge">Доступно<\/span>/);
    assert.match(html, /data-program="medicine-international"/);
    assert.match(html, /id="runtime-price"/);
    assert.match(html, /type="submit" disabled/);
  }
});
