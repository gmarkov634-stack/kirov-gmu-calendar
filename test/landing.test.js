import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  index: new URL("../landing/index.html", import.meta.url),
  app: new URL("../landing/app.js", import.meta.url),
  config: new URL("../landing/runtime-config.js", import.meta.url),
  preview: new URL("../landing/assets/landing-preview.js", import.meta.url),
  styles: new URL("../landing/assets/styles.css", import.meta.url),
  pricing: new URL("../landing/assets/pricing.css", import.meta.url),
  landingV1: new URL("../landing/assets/landing-v1.css", import.meta.url),
  feed: new URL("../landing/assets/landing-feed.css", import.meta.url),
  programStatus: new URL("../landing/assets/program-status.css", import.meta.url),
  trialCss: new URL("../landing/assets/trial.css", import.meta.url),
  fonts: new URL("../landing/assets/fonts.css", import.meta.url),
  manage: new URL("../landing/manage/index.html", import.meta.url),
  manageJs: new URL("../landing/manage/manage.js", import.meta.url),
  manageCss: new URL("../landing/manage/manage.css", import.meta.url)
};

async function text(key) { return readFile(files[key], "utf8"); }
async function sha256(key) { return createHash("sha256").update(await readFile(files[key])).digest("hex"); }

test("saved Drive visual assets are preserved byte-for-byte", async () => {
  const expected = {
    styles: "414b96319fd914a207ec2dd2fe1d6666c67bcf66d682af6081af1ec85ac4b59e",
    pricing: "2067c167a126fbaabfe579e4366ecfbc7abb1590a0eea3ee62e90920201252cb",
    landingV1: "1515b43300752ef742dcbb4bd4497c0491c577c9bc93b2b77378055899e120ca",
    feed: "6ba8e59afb5c4312d90e7d7b66695cf081c2840765c903d3b03f22c4fdad1e1b",
    programStatus: "c4d950a1f11e3d16b25f3212ce4ccb1458e65a0f5eb48efcdd19d9a409bf2854",
    trialCss: "033c4d7601ab42aeea684f2616ddb47b339ab8c1461c3d66df85331b02da409c",
    preview: "a2e139b4489e8923af9034f14d3604f59c2c9b161b66af4476baa9035438c122",
    fonts: "515693c4de613509aa39abbd39e507ed946b2cacd5a0d2cbcc5a256d62cf6846"
  };
  for (const [key, digest] of Object.entries(expected)) assert.equal(await sha256(key), digest, key);
});

test("saved marketing copy and calendar demo are retained", async () => {
  const html = await text("index");
  for (const phrase of [
    "Не ищи расписание каждый день",
    "Пары вашей группы уже в календаре телефона",
    "Мы не сделали ещё одно место, где можно посмотреть расписание",
    "Сначала увидьте результат — потом решайте",
    "Одна paid-ссылка",
    "ЛЕКЦ. БИОЭТИКА",
    "10:30",
    "16 марта"
  ]) assert.ok(html.includes(phrase), phrase);
});

test("only current KGMU product-scope programs remain", async () => {
  const html = await text("index");
  assert.match(html, />Лечебное дело</);
  assert.match(html, />Педиатрия</);
  assert.match(html, />Стоматология</);
  assert.doesNotMatch(html, /Иностранные обучающиеся/);
});

test("legacy project runtime dependencies are removed", async () => {
  const combined = `${await text("index")}\n${await text("app")}`;
  for (const legacy of ["containerapps.ru", "/api/v1", "/api/v2", "file:///Users/", "analytics.js", "app-utils.js", "program-status.js", "data.js", "saved-orders"]) {
    assert.ok(!combined.includes(legacy), legacy);
  }
});

test("runtime stays fail-closed until production enable", async () => {
  const config = await text("config");
  assert.match(config, /trialEnabled:\s*false/);
  assert.match(config, /managementEnabled:\s*false/);
  assert.match(config, /checkoutEnabled:\s*false/);
  assert.match(config, /apiBase:\s*""/);
  assert.match(config, /electiveCatalog:\s*\{\}/);
  assert.match(config, /facultativeCatalog:\s*\{\}/);
});

test("trial wiring follows current core contract", async () => {
  const app = await text("app");
  for (const field of ["email", "universityId", "groupId", "academicYearId", "academicPeriodId"]) assert.match(app, new RegExp(`${field}[,:]`));
  assert.match(app, /fetch\(apiUrl\("\/trial"\)/);
  assert.doesNotMatch(app, /customerId/);
});

test("management proof still uses fragment to POST", async () => {
  const manageHtml = await text("manage");
  const manageJs = await text("manageJs");
  assert.match(manageHtml, /manage\.js/);
  assert.match(manageJs, /window\.location\.hash/);
  assert.match(manageJs, /history\.replaceState/);
  assert.match(manageJs, /"\/management\/verify"/);
  assert.match(manageJs, /JSON\.stringify\(\{ magicToken: token \}\)/);
  assert.doesNotMatch(manageJs, /management\/verify\?/);
});

test("management UI exposes only supported calendar preferences", async () => {
  const manageHtml = await text("manage");
  const manageJs = await text("manageJs");
  const manageCss = await text("manageCss");
  assert.match(manageHtml, /дисциплины по выбору/i);
  assert.match(manageHtml, /факультативы/i);
  assert.match(manageHtml, /несколько напоминаний/);
  assert.match(manageHtml, /Преподаватель, аудитория и тип занятия всегда остаются/);
  assert.match(manageHtml, /manage\.css/);
  assert.match(manageJs, /\/management\/subscriptions\/\$\{encodeURIComponent\(subscriptionId\)\}\/preferences/);
  assert.match(manageJs, /method: "PATCH"/);
  assert.match(manageJs, /electiveChoices:/);
  assert.match(manageJs, /facultativeChoices:/);
  assert.match(manageJs, /facultativeCatalog/);
  assert.match(manageJs, /remindersMinutesBefore:/);
  assert.doesNotMatch(manageJs, /showTeacher|showLocation|showLessonType|showSequence/);
  assert.match(manageCss, /\.preference-panel/);
});

test("landing contains no embedded production secrets", async () => {
  const combined = [await text("index"), await text("app"), await text("config"), await text("manageJs")].join("\n");
  assert.doesNotMatch(combined, /RESEND_API_KEY/);
  assert.doesNotMatch(combined, /re_[A-Za-z0-9_-]{12,}/);
});
