import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeGoogleCalendarCandidates,
  parseGoogleOAuthReturn,
  resolveGoogleOAuthMessageSubscriptionId,
  validateGoogleAuthorizationUrl
} from "../landing/manage/google-calendar.js";

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
