import assert from "node:assert/strict";
import test from "node:test";
import { getUniversityConfig } from "../src/universities/registry.mjs";

test("IzhGMU remains fail-closed during 2026/27 prelaunch", () => {
  const university = getUniversityConfig("izhgmu");

  assert.equal(university.active, false);
  assert.equal(university.sitePath, "/izhgmu/");

  const scope = Object.fromEntries(
    university.programs.map((program) => [program.id, program.initialScope]),
  );

  assert.deepEqual(scope, {
    medicine: true,
    pediatrics: false,
    dentistry: false,
  });
});
