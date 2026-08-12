import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { findPurchasedOrder } = require("../../app-utils.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

async function text(name) {
  return fs.readFile(path.join(root, name), "utf8");
}

test("KGMU landing posts selected plan to the v2 payment endpoint", async () => {
  const app = await text("app.js");
  assert.match(app, /\/api\/v2\/payments/);
  assert.match(app, /plan:\s*state\.plan/);
  assert.match(app, /university:\s*data\.university/);
  assert.doesNotMatch(app, /\/api\/v1\/payments/);
});

test("KGMU landing exposes semester 299 and year 499 plans", async () => {
  const data = await text("data.js");
  assert.match(data, /semester:[\s\S]*price:\s*"299 ₽"/);
  assert.match(data, /year:[\s\S]*price:\s*"499 ₽"/);
  assert.match(data, /badge:\s*"Выгоднее"/);
});

test("KGMU landing keeps the 2026/27 offer closed until a verified schedule is available", async () => {
  const html = await text("index.html");
  const data = await text("data.js");
  assert.match(html, /Продажа открывается только после проверки расписания/);
  assert.match(html, /Архивные расписания прошлых семестров используются только для проверки парсера/);
  assert.doesNotMatch(data, /groups:\s*\{\s*1:\s*\[/);
});

test("KGMU landing loads groups from the server-scoped current-offer catalog", async () => {
  const app = await text("app.js");
  assert.match(app, /\/api\/v2\/catalog\/\$\{university\}\/\$\{program\}\/\$\{course\}\/groups/);
  assert.match(app, /body\.groups/);
  assert.match(app, /normalizeAcademicYear\(body\.academicYear\)\s*===\s*normalizeAcademicYear\(data\.offer\.academicYear\)/);
  assert.match(app, /Number\(body\.semester\)\s*===\s*Number\(data\.offer\.semester\)/);
  assert.doesNotMatch(app, /\/api\/v2\/catalog\/[^`\n]*\?(?:academicYear|semester)=/);
  assert.match(app, /Не удалось проверить опубликованные группы/);
});

test("KGMU landing and Pages artifact use the same production API base", async () => {
  const data = await text("data.js");
  const workflow = await text(".github/workflows/omgmu-pages.yml");
  assert.match(data, /apiBase:\s*"https:\/\/kgmu-calendar-api\.containerapps\.ru"/);
  assert.doesNotMatch(data, /student-calendar-api\.containerapps\.ru/);
  assert.match(workflow, /DEFAULT_API_URL:\s*https:\/\/kgmu-calendar-api\.containerapps\.ru/);
  assert.match(workflow, /path:\s*'dist\/site\/data\.js'/);
  assert.match(workflow, /replacement:\s*`apiBase: "\$\{apiUrl\}"`/);
});

test("an existing year purchase prevents a narrower duplicate purchase", async () => {
  const saved = [{ orderId: "a".repeat(32), accessToken: "b".repeat(43) }];
  const existingYear = await findPurchasedOrder("132", saved, async () => ({
    status: "succeeded",
    group: "132",
    plan: "year",
  }), "semester");
  assert.ok(existingYear);
});

test("an existing semester purchase does not block choosing the year plan", async () => {
  const saved = [{ orderId: "a".repeat(32), accessToken: "b".repeat(43) }];
  const existingYear = await findPurchasedOrder("132", saved, async () => ({
    status: "succeeded",
    group: "132",
    plan: "semester",
  }), "year");
  assert.equal(existingYear, null);
});
