import assert from "node:assert/strict";
import test from "node:test";
import { proxyContractObservation } from "../src/proxy-contract-observation.js";

test("proxy observation reveals only structure, never raw addresses", () => {
  const result = proxyContractObservation({
    headers: {
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10, 198.51.100.7",
    },
    socket: { remoteAddress: "::ffff:198.51.100.7" },
  });

  assert.deepEqual(result, {
    version: 1,
    xRealIpPresent: true,
    xForwardedForPresent: true,
    xForwardedForHopCount: 2,
    socketAddressPresent: true,
    xRealIpEqualsFirstXff: true,
    xRealIpEqualsLastXff: false,
    socketEqualsFirstXff: false,
    socketEqualsLastXff: true,
    policyResolution: "x-real-ip",
  });
  assert.doesNotMatch(JSON.stringify(result), /203\.0\.113\.10|198\.51\.100\.7/);
});

test("single XFF is recognized by the current trial identity policy", () => {
  const result = proxyContractObservation({
    headers: { "x-forwarded-for": "203.0.113.10" },
    socket: { remoteAddress: "10.0.0.4" },
  });
  assert.equal(result.xForwardedForHopCount, 1);
  assert.equal(result.policyResolution, "single-x-forwarded-for");
});

test("multi-hop XFF without X-Real-IP remains explicitly ambiguous", () => {
  const result = proxyContractObservation({
    headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.7" },
    socket: { remoteAddress: "198.51.100.7" },
  });
  assert.equal(result.xForwardedForHopCount, 2);
  assert.equal(result.socketEqualsLastXff, true);
  assert.equal(result.policyResolution, "ambiguous-x-forwarded-for");
});
