import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("medicine 3 elective catalog is published for exactly groups 301-317", () => {
  for (const path of ["deploy/runtime-config.production.js", "deploy/runtime-config.pages.js"]) {
    const config = read(path);
    assert.match(config, /selectionId:\s*"medicine-3-choice-discipline-2026-s1"/);
    for (const groupId of ["301", "310", "311", "317"]) {
      assert.match(config, new RegExp(`"${groupId}"`), `${path}: ${groupId}`);
    }
    assert.doesNotMatch(config, /"318"/);
    for (const option of [
      "biochemical-healthy-lifestyle",
      "dietology",
      "latin-pharmaceutical-terminology",
      "intercultural-professional-communication",
      "molecular-pathology",
      "functional-diagnostics",
      "statistical-evidence-medicine"
    ]) {
      assert.match(config, new RegExp(`value: "${option}"`), `${path}: ${option}`);
    }
  }
});

test("trial personalization injects selected preferences into POST /trial", async () => {
  const source = read("landing/trial-personalization.js");
  let activeForm = null;
  let captured = null;

  const form = {
    querySelectorAll(selector) {
      if (selector === "select[data-selection-id]") {
        return [{ dataset: { selectionId: "medicine-3-choice-discipline-2026-s1" }, value: "dietology" }];
      }
      if (selector === "input[data-facultative-id]") {
        return [{ dataset: { facultativeId: "fac-a" }, checked: true }];
      }
      if (selector === "input[data-reminder-minutes]:checked") {
        return [
          { dataset: { reminderMinutes: "30" } },
          { dataset: { reminderMinutes: "1440" } }
        ];
      }
      return [];
    }
  };

  const sandbox = {
    URL,
    Request,
    HTMLFormElement: class {},
    window: { location: { href: "https://calendar.example/" } },
    document: {
      documentElement: {},
      readyState: "complete",
      querySelector(selector) {
        return selector === "#runtime-trial-form" ? activeForm : null;
      },
      addEventListener() {},
      head: { append() {} }
    },
    MutationObserver: class {
      observe() {}
    },
    KGMU_CALENDAR_CONFIG: {
      academicPeriodId: "2026-2027-semester-1",
      electiveCatalog: {},
      facultativeCatalog: {}
    },
    fetch: async (input, init) => {
      captured = { input, init };
      return { ok: true };
    }
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox, { filename: "trial-personalization.js" });
  activeForm = form;

  await sandbox.fetch("https://calendar.example/trial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "student@example.com",
      universityId: "kirov-gmu",
      groupId: "301",
      academicYearId: "2026-2027",
      academicPeriodId: "2026-2027-semester-1"
    })
  });

  const payload = JSON.parse(captured.init.body);
  assert.deepEqual(payload.preferences, {
    electiveChoices: {
      "medicine-3-choice-discipline-2026-s1": "dietology"
    },
    facultativeChoices: { "fac-a": true },
    remindersMinutesBefore: [30, 1440]
  });
});

test("trial UI requires an elective choice before submission", () => {
  const source = read("landing/trial-personalization.js");
  assert.match(source, /select\.required = true/);
  assert.match(source, /Выберите дисциплину/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /Сначала выберите свою дисциплину по выбору/);
});

test("built landing loads personalization before app and fixes management empty-state copy", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "kgmu-personalization-"));
  const output = join(tempRoot, "site");
  try {
    const result = spawnSync("sh", ["deploy/build-pages.sh", output], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const index = readFileSync(join(output, "index.html"), "utf8");
    const personalizationAt = index.indexOf("./trial-personalization.js");
    const appAt = index.indexOf("./app.js");
    assert.ok(personalizationAt >= 0);
    assert.ok(appAt > personalizationAt);

    const manageIndex = readFileSync(join(output, "manage", "index.html"), "utf8");
    assert.match(manageIndex, /\.\/elective-empty-state\.js/);
    const helper = readFileSync(join(output, "manage", "elective-empty-state.js"), "utf8");
    assert.match(helper, /Не выбрано — скрыть варианты/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
