import assert from "node:assert/strict";
import test from "node:test";

import {
  UGMU_COURSE1_GROUPS,
  ugmuCourse1ContextAllowed,
} from "../src/ugmu-course1-access-policy.mjs";
import {
  runtimeTrialContextAllowed,
  ugmuTrialScopeAllowed,
} from "../src/trial-access-policy.mjs";

function contextFor(group) {
  return {
    university: group.university,
    program: group.program,
    course: group.course,
    stream: group.stream,
    groupCode: group.groupCode,
    groupId: group.groupId,
  };
}

test("UGMU course-1 access catalog is exactly the 50 reviewed groups", () => {
  assert.equal(UGMU_COURSE1_GROUPS.length, 50);
  assert.deepEqual(
    Object.fromEntries(["1", "2", "3", "4"].map((stream) => [
      stream,
      UGMU_COURSE1_GROUPS.filter((group) => group.stream === stream).length,
    ])),
    { 1: 12, 2: 12, 3: 12, 4: 14 },
  );
  assert.equal(UGMU_COURSE1_GROUPS[0].groupCode, "ОЛД 101");
  assert.equal(UGMU_COURSE1_GROUPS.at(-1).groupCode, "ОЛД 150");
  assert.deepEqual(
    Object.keys(UGMU_COURSE1_GROUPS[0]).sort(),
    ["course", "groupCode", "groupId", "program", "stream", "university"],
  );
});

test("every reviewed canonical UGMU course-1 context is allowed", () => {
  for (const group of UGMU_COURSE1_GROUPS) {
    const context = contextFor(group);
    assert.equal(ugmuCourse1ContextAllowed(context), true, group.groupCode);
    assert.equal(ugmuTrialScopeAllowed(context), true, group.groupCode);
  }
});

test("UGMU course-1 access fails closed outside the exact catalog", () => {
  const valid = contextFor(UGMU_COURSE1_GROUPS.at(-1));

  const rejected = [
    { ...valid, groupCode: "ОЛД 151", groupId: "ugmu:medicine:1:stream-4:ОЛД 151" },
    { ...valid, groupCode: "ОЛД 100", stream: "1", groupId: "ugmu:medicine:1:stream-1:ОЛД 100" },
    { ...valid, stream: "3" },
    { ...valid, groupId: "ugmu:medicine:1:stream-4:ОЛД 149" },
    { ...valid, university: "kgmu" },
    { ...valid, program: "pediatrics" },
    { ...valid, program: undefined, faculty: "medicine" },
    { ...valid, course: 2 },
    { ...valid, groupCode: undefined },
    { ...valid, groupId: undefined },
    {},
  ];

  for (const context of rejected) {
    assert.equal(ugmuCourse1ContextAllowed(context), false, JSON.stringify(context));
  }
});

test("UGMU trial access requires the dedicated UGMU trial flag", () => {
  const valid = contextFor(UGMU_COURSE1_GROUPS[12]);
  assert.equal(valid.groupCode, "ОЛД 113");

  assert.equal(runtimeTrialContextAllowed({ ugmuTrialsEnabled: false }, valid), false);
  assert.equal(runtimeTrialContextAllowed({ trialsEnabled: true, ugmuTrialsEnabled: false }, valid), false);
  assert.equal(runtimeTrialContextAllowed({ globalTrialsEnabled: true, ugmuTrialsEnabled: false }, valid), false);
  assert.equal(runtimeTrialContextAllowed({ ugmuTrialsEnabled: true }, valid), true);
  assert.equal(
    runtimeTrialContextAllowed(
      { ugmuTrialsEnabled: true },
      { ...valid, groupCode: "ОЛД 151", groupId: "ugmu:medicine:1:stream-4:ОЛД 151" },
    ),
    false,
  );
});
