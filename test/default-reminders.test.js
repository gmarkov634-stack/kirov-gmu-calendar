import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("new checkout sends 10 and 60 minute reminders by default", async () => {
  const source = await read("landing/acquisition-ui.js");
  let captured = null;

  const sandbox = {
    URL,
    URLSearchParams,
    Request,
    Headers,
    Response,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    document: {
      querySelector() { return null; }
    },
    window: {
      location: {
        origin: "https://calendar.example",
        href: "https://calendar.example/"
      },
      addEventListener() {}
    },
    fetch: async (input, init) => {
      captured = { input, init };
      return { ok: false };
    }
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox, { filename: "acquisition-ui.js" });

  await sandbox.fetch("https://calendar.example/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "test-checkout-key"
    },
    body: JSON.stringify({
      email: "student@example.com",
      universityId: "kirov-gmu",
      groupId: "401",
      academicYearId: "2026-2027",
      academicPeriodId: "2026-2027-semester-1",
      productCode: "semester-access"
    })
  });

  const payload = JSON.parse(captured.init.body);
  assert.deepEqual(payload.preferences, {
    electiveChoices: {},
    facultativeChoices: {},
    remindersMinutesBefore: [10, 60]
  });
});

test("trial and acquisition reminder controls use the same defaults", async () => {
  const acquisition = await read("landing/acquisition-ui.js");
  const trial = await read("landing/trial-personalization.js");

  for (const source of [acquisition, trial]) {
    assert.match(source, /DEFAULT_REMINDERS\s*=\s*Object\.freeze\(\[10, 60\]\)/);
  }

  assert.match(acquisition, /REMINDER_OPTIONS\s*=\s*Object\.freeze\(\[10, 30, 60, 1440\]\)/);
  assert.match(trial, /input\.checked\s*=\s*DEFAULT_REMINDERS\.includes\(reminder\.value\)/);
});
