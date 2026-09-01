import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../landing/trial-personalization.js", import.meta.url), "utf8");

function preferenceForm() {
  return {
    querySelectorAll(selector) {
      if (selector === "select[data-selection-id]") {
        return [{ dataset: { selectionId: "selection-a" }, value: "option-b" }];
      }
      if (selector === "input[data-facultative-id]") {
        return [{ dataset: { facultativeId: "fac-a" }, checked: true }];
      }
      if (selector === "input[data-reminder-minutes]:checked") {
        return [{ dataset: { reminderMinutes: "30" } }];
      }
      return [];
    }
  };
}

async function captureRequest(path, formId) {
  const form = preferenceForm();
  let captured = null;
  const sandbox = {
    URL,
    Request,
    HTMLFormElement: class {},
    window: { location: { href: "https://calendar.example/" } },
    document: {
      documentElement: {},
      readyState: "complete",
      querySelector(selector) {
        return selector === `#${formId}` ? form : null;
      },
      addEventListener() {},
      head: { append() {} }
    },
    MutationObserver: class { observe() {} },
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

  await sandbox.fetch(`https://calendar.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "student@example.com" })
  });
  return JSON.parse(captured.init.body);
}

test("email-step preferences are attached to trial requests", async () => {
  const payload = await captureRequest("/trial", "runtime-trial-form");
  assert.deepEqual(payload.preferences, {
    electiveChoices: { "selection-a": "option-b" },
    facultativeChoices: { "fac-a": true },
    remindersMinutesBefore: [30]
  });
});

test("email-step preferences are attached to checkout requests", async () => {
  const payload = await captureRequest("/checkout", "runtime-checkout-form");
  assert.deepEqual(payload.preferences, {
    electiveChoices: { "selection-a": "option-b" },
    facultativeChoices: { "fac-a": true },
    remindersMinutesBefore: [30]
  });
});

test("the email-step component explicitly supports both acquisition forms", () => {
  assert.match(source, /runtime-trial-form/);
  assert.match(source, /runtime-checkout-form/);
  assert.match(source, /pathname\.endsWith\("\/trial"\)/);
  assert.match(source, /pathname\.endsWith\("\/checkout"\)/);
});

test("acquisition wiring still preserves shared defaults and checkout handoff", () => {
  const acquisition = readFileSync(new URL("../landing/acquisition-ui.js", import.meta.url), "utf8");
  assert.match(acquisition, /isTrial \|\| isCheckout/);
  assert.match(acquisition, /body\.preferences = clonePreferences\(\)/);
  assert.match(acquisition, /CHECKOUT_CONTEXT_KEY/);
});