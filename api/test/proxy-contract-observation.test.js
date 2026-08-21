import assert from "node:assert/strict";
import test from "node:test";
import { proxyContractObservation } from "../src/proxy-contract-observation.js";

test("proxy observation reveals only structure, never raw addresses", () => {
  const result = proxyContractObservation({
    headers: {
      "x-real-ip": "192.0.2.10",
      "x-forwarded-for": "192.0.2.10, 192.0.2.20",
    },
    socket: { remoteAddress: "::ffff:192.0.2.20" },
  });

  assert.equal(result.version, 2);
  assert.equal(result.xRealIpPresent, true);
  assert.equal(result.xForwardedForPresent, true);
  assert.equal(result.xForwardedForHopCount, 2);
  assert.equal(result.socketAddressPresent, true);
  assert.equal(result.xRealIpEqualsFirstXff, true);
  assert.equal(result.xRealIpEqualsLastXff, false);
  assert.equal(result.socketEqualsFirstXff, false);
  assert.equal(result.socketEqualsLastXff, true);
  assert.equal(result.expectedClientProvided, false);
  assert.equal(result.probeSentinelProvided, false);
  assert.equal(result.policyResolution, "x-real-ip");
  assert.doesNotMatch(JSON.stringify(result), /192\.0\.2\.10|192\.0\.2\.20/);
});

test("probe compares ingress values to expected client and sentinel without returning either", () => {
  const result = proxyContractObservation({
    headers: {
      "x-real-ip": "192.0.2.10",
      "x-forwarded-for": "192.0.2.30, 192.0.2.10",
      "x-proxy-probe-expected-client": "192.0.2.10",
      "x-proxy-probe-sentinel": "192.0.2.30",
    },
    socket: { remoteAddress: "192.0.2.40" },
  });

  assert.equal(result.expectedClientProvided, true);
  assert.equal(result.xRealIpEqualsExpectedClient, true);
  assert.equal(result.firstXffEqualsExpectedClient, false);
  assert.equal(result.lastXffEqualsExpectedClient, true);
  assert.equal(result.probeSentinelProvided, true);
  assert.equal(result.xRealIpEqualsProbeSentinel, false);
  assert.equal(result.firstXffEqualsProbeSentinel, true);
  assert.equal(result.lastXffEqualsProbeSentinel, false);
  assert.doesNotMatch(JSON.stringify(result), /192\.0\.2\.10|192\.0\.2\.30/);
});

test("single XFF is recognized by the current trial identity policy", () => {
  const result = proxyContractObservation({
    headers: { "x-forwarded-for": "192.0.2.10" },
    socket: { remoteAddress: "192.0.2.40" },
  });
  assert.equal(result.xForwardedForHopCount, 1);
  assert.equal(result.policyResolution, "single-x-forwarded-for");
});

test("multi-hop XFF without X-Real-IP remains explicitly ambiguous", () => {
  const result = proxyContractObservation({
    headers: { "x-forwarded-for": "192.0.2.10, 192.0.2.20" },
    socket: { remoteAddress: "192.0.2.20" },
  });
  assert.equal(result.xForwardedForHopCount, 2);
  assert.equal(result.socketEqualsLastXff, true);
  assert.equal(result.policyResolution, "ambiguous-x-forwarded-for");
});
