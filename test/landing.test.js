import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  index: new URL("../landing/index.html", import.meta.url),
  app: new URL("../landing/app.js", import.meta.url),
  config: new URL("../landing/runtime-config.js", import.meta.url),
  manage: new URL("../landing/manage/index.html", import.meta.url),
  manageJs: new URL("../landing/manage/manage.js", import.meta.url)
};

async function text(key) {
  return readFile(files[key], "utf8");
}

test("landing has only the three KGMU project programs", async () => {
  const html = await text("index");
  assert.match(html, />Лечебное дело</);
  assert.match(html, />Педиатрия</);
  assert.match(html, />Стоматология</);
  assert.doesNotMatch(html, /Иностранные обучающиеся/);
});

test("landing is mobile-first and exposes both required primary CTAs", async () => {
  const html = await text("index");
  assert.match(html, /name="viewport"/);
  assert.match(html, /Попробовать 7 дней бесплатно/);
  assert.match(html, /Купить полный доступ/);
});

test("landing preview uses the verified KGMU 101 events from 2026-09-02", async () => {
  const html = await text("index");
  assert.match(html, /08:00/);
  assert.match(html, /10:25/);
  assert.match(html, /Общая и биоорганическая химия/);
  assert.match(html, /10:50/);
  assert.match(html, /ЛЕКЦ\. ФИЗИКА, МАТЕМАТИКА/);
  assert.match(html, /12:30/);
  assert.match(html, /ЛЕКЦ\. БИОЛОГИЯ/);
  assert.match(html, /14:50/);
  assert.match(html, /Основы российской государственности/);
});

test("runtime is fail-closed until production enable", async () => {
  const config = await text("config");
  assert.match(config, /trialEnabled:\s*false/);
  assert.match(config, /managementEnabled:\s*false/);
  assert.match(config, /checkoutEnabled:\s*false/);
  assert.match(config, /apiBase:\s*""/);
});

test("trial request follows the exact current core input contract", async () => {
  const app = await text("app");
  for (const field of ["email", "universityId", "groupId", "academicYearId", "academicPeriodId"]) {
    assert.match(app, new RegExp(`${field}:`));
  }
  assert.match(app, /fetch\(apiUrl\("\/trial"\)/);
  assert.doesNotMatch(app, /customerId:/);
});

test("management proof uses fragment to POST and never puts magic token in API query", async () => {
  const manageHtml = await text("manage");
  const manageJs = await text("manageJs");
  assert.match(manageHtml, /manage\.js/);
  assert.match(manageJs, /window\.location\.hash/);
  assert.match(manageJs, /history\.replaceState/);
  assert.match(manageJs, /"\/management\/verify"/);
  assert.match(manageJs, /JSON\.stringify\(\{ magicToken: token \}\)/);
  assert.doesNotMatch(manageJs, /management\/verify\?/);
});

test("landing contains no file URLs or embedded production secrets", async () => {
  const combined = [await text("index"), await text("app"), await text("config"), await text("manageJs")].join("\n");
  assert.doesNotMatch(combined, /file:\/\//);
  assert.doesNotMatch(combined, /RESEND_API_KEY/);
  assert.doesNotMatch(combined, /re_[A-Za-z0-9_-]{12,}/);
});
