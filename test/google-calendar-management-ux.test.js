import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeGoogleCalendarCandidates,
  parseGoogleOAuthReturn,
  resolveGoogleOAuthMessageSubscriptionId,
  resolveGoogleSubscriptionForCard,
  validateGoogleAuthorizationUrl
} from "../landing/manage/google-calendar.js";

function fakeCard(title, meta) {
  return {
    querySelector(selector) {
      if (selector === "h3") return { textContent: title };
      if (selector === ".subscription-meta") return { textContent: meta };
      return null;
    }
  };
}

test("Google OAuth return requires one explicit status and subscription for selection", () => {
  assert.deepEqual(
    parseGoogleOAuthReturn("https://example.test/manage/?googleCalendar=select&subscriptionId=sub-1"),
    { status: "select", subscriptionId: "sub-1" }
  );
  assert.deepEqual(
    parseGoogleOAuthReturn("https://example.test/manage/?googleCalendar=error"),
    { status: "error", subscriptionId: null }
  );
  assert.equal(
    parseGoogleOAuthReturn("https://example.test/manage/?googleCalendar=select"),
    null
  );
  assert.equal(
    parseGoogleOAuthReturn("https://example.test/manage/?googleCalendar=select&googleCalendar=error&subscriptionId=sub-1"),
    null
  );
});

test("Google authorization URL is pinned to the exact OAuth endpoint", () => {
  const valid = "https://accounts.google.com/o/oauth2/v2/auth?state=s&code_challenge=c";
  assert.equal(validateGoogleAuthorizationUrl(valid), valid);
  assert.throws(
    () => validateGoogleAuthorizationUrl("https://accounts.google.com.evil.example/o/oauth2/v2/auth?state=s&code_challenge=c"),
    /Некорректный адрес Google OAuth/
  );
  assert.throws(
    () => validateGoogleAuthorizationUrl("https://accounts.google.com/o/oauth2/v2/auth?state=s"),
    /Некорректный адрес Google OAuth/
  );
});

test("candidate normalization preserves metadata but never chooses a calendar", () => {
  const candidates = normalizeGoogleCalendarCandidates([
    { id: "primary", summary: "Основной", primary: true, selected: true },
    { id: "kgmu", summary: "КГМУ", primary: false, selected: false }
  ]);
  assert.deepEqual(candidates, [
    { id: "primary", summary: "Основной", primary: true, selected: true },
    { id: "kgmu", summary: "КГМУ", primary: false, selected: false }
  ]);
  assert.equal(candidates.some((candidate) => Object.hasOwn(candidate, "chosen")), false);
});

test("OAuth popup source binds both success and provider error to the opened subscription", () => {
  const popupA = {};
  const popupB = {};
  const entries = new Map([["sub-a", popupA], ["sub-b", popupB]]);

  assert.equal(resolveGoogleOAuthMessageSubscriptionId({
    message: { status: "select", subscriptionId: "sub-a" },
    source: popupA,
    popupEntries: entries
  }), "sub-a");

  assert.equal(resolveGoogleOAuthMessageSubscriptionId({
    message: { status: "error", subscriptionId: null },
    source: popupB,
    popupEntries: entries
  }), "sub-b");

  assert.equal(resolveGoogleOAuthMessageSubscriptionId({
    message: { status: "select", subscriptionId: "sub-a" },
    source: popupB,
    popupEntries: entries
  }), null);

  assert.equal(resolveGoogleOAuthMessageSubscriptionId({
    message: { status: "error", subscriptionId: "sub-a" },
    source: popupB,
    popupEntries: entries
  }), null);
});

test("Google panel resolves a subscription from the rendered card only when identity is unique", () => {
  const first = {
    subscription: {
      subscriptionId: "sub-1",
      universityId: "kirov-gmu",
      groupId: "114",
      academicYearId: "2026-2027"
    }
  };
  const second = {
    subscription: {
      subscriptionId: "sub-2",
      universityId: "kirov-gmu",
      groupId: "115",
      academicYearId: "2026-2027"
    }
  };

  assert.equal(
    resolveGoogleSubscriptionForCard(
      fakeCard("kirov-gmu · группа 114", "2026-2027 · Активный доступ"),
      [first, second]
    ),
    first
  );
  assert.equal(
    resolveGoogleSubscriptionForCard(
      fakeCard("kirov-gmu · группа 114", "2025-2026 · Активный доступ"),
      [first, second]
    ),
    null
  );
  assert.equal(
    resolveGoogleSubscriptionForCard(
      fakeCard("kirov-gmu · группа 114", "2026-2027 · Активный доступ"),
      [first, { ...first, subscription: { ...first.subscription, subscriptionId: "duplicate" } }]
    ),
    null
  );
});

test("Google UI observes the existing subscription response instead of issuing a second list request", async () => {
  const source = await readFile(new URL("../landing/manage/google-calendar.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /apiRequest\(config,\s*["']\/management\/subscriptions["']/);
  assert.match(source, /response\.clone\(\)\.json\(\)/);
  assert.match(source, /resolveGoogleSubscriptionForCard\(card, subscriptionSnapshot\)/);
});

test("each Google OAuth connect opens a distinct browsing context", async () => {
  const source = await readFile(new URL("../landing/manage/google-calendar.js", import.meta.url), "utf8");
  assert.match(source, /window\.open\("about:blank",\s*"_blank"/);
  assert.doesNotMatch(source, /window\.open\("about:blank",\s*"kgmu-google-calendar-oauth"/);
});

test("GitHub Pages bearer management credential is not persisted in browser storage", async () => {
  const source = await readFile(new URL("../landing/manage/session-transport.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /sessionStorage|localStorage/);
  assert.match(source, /let managementToken = null/);
});

test("Google management UI stays fail-closed unless explicitly enabled", async () => {
  const source = await readFile(new URL("../landing/manage/google-calendar.js", import.meta.url), "utf8");
  assert.match(source, /googleCalendarEnabled: false/);
  assert.match(source, /!config\.googleCalendarEnabled \|\| !config\.managementEnabled/);
});
