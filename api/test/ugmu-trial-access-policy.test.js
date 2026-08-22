import test from "node:test";
import assert from "node:assert/strict";
import {
  runtimeTrialContextAllowed,
  ugmuTrialScopeAllowed,
  UGMU_FIRST_STREAM_GROUPS,
  UGMU_SECOND_STREAM_GROUPS,
} from "../src/trial-access-policy.mjs";

function context(groupCode, stream) {
  return {
    university: "ugmu",
    program: "medicine",
    course: 1,
    stream,
    groupCode,
    groupId: `ugmu:medicine:1:stream-${stream}:${groupCode}`,
  };
}

test("UGMU course 1 trial scope accepts reviewed groups in both streams", () => {
  assert.equal(UGMU_FIRST_STREAM_GROUPS.length, 12);
  assert.equal(UGMU_SECOND_STREAM_GROUPS.length, 12);
  assert.equal(UGMU_FIRST_STREAM_GROUPS[0], "ОЛД 101");
  assert.equal(UGMU_FIRST_STREAM_GROUPS.at(-1), "ОЛД 112");
  assert.equal(UGMU_SECOND_STREAM_GROUPS[0], "ОЛД 113");
  assert.equal(UGMU_SECOND_STREAM_GROUPS.at(-1), "ОЛД 124");

  assert.equal(ugmuTrialScopeAllowed(context("ОЛД 101", "1")), true);
  assert.equal(ugmuTrialScopeAllowed(context("ОЛД 112", "1")), true);
  assert.equal(ugmuTrialScopeAllowed(context("ОЛД 113", "2")), true);
  assert.equal(ugmuTrialScopeAllowed(context("ОЛД 124", "2")), true);
});

test("UGMU trial scope rejects stream/group mismatches and unknown groups", () => {
  assert.equal(ugmuTrialScopeAllowed(context("ОЛД 113", "1")), false);
  assert.equal(ugmuTrialScopeAllowed(context("ОЛД 112", "2")), false);
  assert.equal(ugmuTrialScopeAllowed(context("ОЛД 125", "2")), false);
  assert.equal(
    ugmuTrialScopeAllowed({
      ...context("ОЛД 113", "2"),
      groupId: "ugmu:medicine:1:stream-1:ОЛД 113",
    }),
    false,
  );
});

test("UGMU trial scope remains restricted to medicine course 1", () => {
  assert.equal(ugmuTrialScopeAllowed({ ...context("ОЛД 113", "2"), university: "kgmu" }), false);
  assert.equal(ugmuTrialScopeAllowed({ ...context("ОЛД 113", "2"), program: "pediatrics" }), false);
  assert.equal(ugmuTrialScopeAllowed({ ...context("ОЛД 113", "2"), course: 2 }), false);
});

test("UGMU second-stream trials still require the university-specific trial gate", () => {
  const secondStream = context("ОЛД 113", "2");
  assert.equal(runtimeTrialContextAllowed({ ugmuTrialsEnabled: true }, secondStream), true);
  assert.equal(runtimeTrialContextAllowed({ ugmuTrialsEnabled: false }, secondStream), false);
});
