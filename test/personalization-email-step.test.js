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

function personalizationInsertedForHeading(formId, headingText) {
  let inserted = null;
  const submit = {};
  const form = {
    id: formId,
    closest(selector) {
      if (selector !== ".trial-connect-card") return null;
      return {
        querySelector(innerSelector) {
          return innerSelector === "h3" ? { textContent: headingText } : null;
        }
      };
    },
    querySelector(selector) {
      if (selector === "[data-trial-personalization-root]") return inserted;
      if (selector === 'button[type="submit"]') return submit;
      return null;
    },
    insertBefore(node, before) {
      assert.equal(before, submit);
      inserted = node;
    },
    append(node) {
      inserted = node;
    }
  };

  function element() {
    return {
      className: "",
      dataset: {},
      textContent: "",
      append() {}
    };
  }

  const sandbox = {
    URL,
    Request,
    HTMLFormElement: class {},
    window: { location: { href: "https://calendar.example/" } },
    document: {
      documentElement: {},
      readyState: "complete",
      querySelector(selector) {
        if (selector === `#${formId}`) return form;
        return null;
      },
      addEventListener() {},
      createElement() {
        return element();
      },
      head: { append() {} }
    },
    MutationObserver: class { observe() {} },
    KGMU_CALENDAR_CONFIG: {
      academicPeriodId: "2026-2027-semester-1",
      electiveCatalog: {},
      facultativeCatalog: {}
    },
    fetch: async () => ({ ok: true })
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "trial-personalization.js" });
  return inserted?.dataset?.trialPersonalizationRoot === "";
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
      readyState: "loading",
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

test("email-step personalization recognizes both trial and checkout group headings", () => {
  assert.equal(personalizationInsertedForHeading("runtime-trial-form", "Получить календарь группы 501"), true);
  assert.equal(personalizationInsertedForHeading("runtime-checkout-form", "Семестр · группа 501 · 299 ₽"), true);
});

test("the email-step component explicitly supports both acquisition forms", () => {
  assert.match(source, /runtime-trial-form/);
  assert.match(source, /runtime-checkout-form/);
  assert.match(source, /pathname\.endsWith\("\/trial"\)/);
  assert.match(source, /pathname\.endsWith\("\/checkout"\)/);
});

test("pre-choice personalization is suppressed before trial or purchase is selected", () => {
  const refinements = readFileSync(new URL("../landing/acquisition-ux-refinements.js", import.meta.url), "utf8");
  assert.match(refinements, /group-preview > \.acquisition-personalization/);
  assert.match(refinements, /display:none !important/);
  assert.match(refinements, /emailStepPersonalizationPlaceholder/);
  assert.match(refinements, /panel\.replaceWith\(marker\)/);
  assert.match(refinements, /#runtime-trial-email, #runtime-checkout-email/);
});

test("email preference wrapper loads before acquisition wrapper so form values win", () => {
  for (const path of ["../deploy/build-pages.sh", "../deploy/build-landing.sh"]) {
    const builder = readFileSync(new URL(path, import.meta.url), "utf8");
    const emailPreferences = builder.indexOf("trial-personalization.js");
    const acquisition = builder.indexOf("acquisition-ui.js");
    assert.ok(emailPreferences >= 0, `${path}: email personalization script missing`);
    assert.ok(acquisition > emailPreferences, `${path}: acquisition wrapper must load after email preference wrapper`);
  }
});

test("acquisition wiring still preserves checkout handoff before form preferences override defaults", () => {
  const acquisition = readFileSync(new URL("../landing/acquisition-ui.js", import.meta.url), "utf8");
  assert.match(acquisition, /isTrial \|\| isCheckout/);
  assert.match(acquisition, /body\.preferences = clonePreferences\(\)/);
  assert.match(acquisition, /CHECKOUT_CONTEXT_KEY/);
});
