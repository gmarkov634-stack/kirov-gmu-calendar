import assert from "node:assert/strict";
import test from "node:test";
import { trialIdentityFingerprint, trialRequestAddress } from "../src/trial-identity.js";

const SECRET = "trial-identity-test-secret-32-bytes-minimum";

function request(overrides = {}) {
  return {
    headers: {
      "x-forwarded-for": "203.0.113.10",
      "user-agent": "CalendarTest/1.0",
      "accept-language": "ru-RU,ru;q=0.9",
      ...(overrides.headers || {}),
    },
    socket: { remoteAddress: "10.0.0.10", ...(overrides.socket || {}) },
  };
}

test("trial identity fingerprint is deterministic, opaque and request-bound", () => {
  const first = trialIdentityFingerprint(request(), SECRET);
  const second = trialIdentityFingerprint(request(), SECRET);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.equal(first.includes("203.0.113.10"), false);
  assert.equal(first.includes("CalendarTest"), false);

  assert.notEqual(
    first,
    trialIdentityFingerprint(request({ headers: { "x-forwarded-for": "203.0.113.11" } }), SECRET),
  );
  assert.notEqual(
    first,
    trialIdentityFingerprint(request({ headers: { "user-agent": "DifferentBrowser/1.0" } }), SECRET),
  );
});

test("trial identity prefers explicit X-Real-IP over X-Forwarded-For", () => {
  const value = request({
    headers: {
      "x-real-ip": "198.51.100.20",
      "x-forwarded-for": "203.0.113.10",
    },
  });
  assert.equal(trialRequestAddress(value), "198.51.100.20");
});

test("ambiguous multi-hop X-Forwarded-For fails closed until ingress semantics are verified", () => {
  const value = request({ headers: { "x-forwarded-for": "198.51.100.99, 203.0.113.10" } });
  assert.equal(trialRequestAddress(value), "");
  assert.equal(trialIdentityFingerprint(value, SECRET), null);
});

test("trial identity fails closed without a strong secret or trusted proxy address", () => {
  assert.equal(trialIdentityFingerprint(request(), "too-short"), null);
  assert.equal(trialIdentityFingerprint({ headers: {}, socket: { remoteAddress: "203.0.113.15" } }, SECRET), null);
});

test("trial identity normalizes IPv4-mapped forwarded addresses", () => {
  const value = request({ headers: { "x-forwarded-for": "::ffff:203.0.113.15" } });
  assert.equal(trialRequestAddress(value), "203.0.113.15");
});
