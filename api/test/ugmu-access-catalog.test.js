import assert from "node:assert/strict";
import test from "node:test";

import {
  UGMU_ACCESS_GROUPS,
  UGMU_ACCESS_SCOPES,
  ugmuAccessContextAllowed,
  ugmuCheckoutContextAllowed,
  ugmuTrialContextAllowed,
} from "../src/ugmu-access-catalog.mjs";
import { ugmuCourse1ContextAllowed } from "../src/ugmu-course1-access-policy.mjs";

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

test("UGMU access catalog keeps the current reviewed scope exact", () => {
  assert.equal(UGMU_ACCESS_SCOPES.length, 1);
  assert.deepEqual(
    {
      id: UGMU_ACCESS_SCOPES[0].id,
      program: UGMU_ACCESS_SCOPES[0].program,
      course: UGMU_ACCESS_SCOPES[0].course,
      capabilities: UGMU_ACCESS_SCOPES[0].capabilities,
    },
    {
      id: "medicine-1-2026-autumn",
      program: "medicine",
      course: 1,
      capabilities: { checkout: true, trial: true },
    },
  );
  assert.equal(UGMU_ACCESS_GROUPS.length, 50);
  assert.deepEqual(
    Object.fromEntries(["1", "2", "3", "4"].map((stream) => [
      stream,
      UGMU_ACCESS_GROUPS.filter((group) => group.stream === stream).length,
    ])),
    { 1: 12, 2: 12, 3: 12, 4: 14 },
  );
});

test("current reviewed UGMU groups are enabled for checkout and trial", () => {
  for (const group of UGMU_ACCESS_GROUPS) {
    const context = contextFor(group);
    assert.equal(ugmuAccessContextAllowed(context), true, group.groupCode);
    assert.equal(ugmuCheckoutContextAllowed(context), true, group.groupCode);
    assert.equal(ugmuTrialContextAllowed(context), true, group.groupCode);
    assert.equal(ugmuCourse1ContextAllowed(context), true, group.groupCode);
  }
});

test("UGMU access catalog fails closed for unreviewed contexts and capabilities", () => {
  const valid = contextFor(UGMU_ACCESS_GROUPS.at(-1));
  const rejected = [
    { ...valid, course: 2, groupId: "ugmu:medicine:2:stream-4:ОЛД 150" },
    { ...valid, program: "pediatrics", groupId: "ugmu:pediatrics:1:stream-4:ОЛД 150" },
    { ...valid, groupCode: "ОЛД 151", groupId: "ugmu:medicine:1:stream-4:ОЛД 151" },
    { ...valid, stream: "3" },
    { ...valid, groupId: "ugmu:medicine:1:stream-4:ОЛД 149" },
    { ...valid, university: "kgmu" },
    {},
  ];

  for (const context of rejected) {
    assert.equal(ugmuAccessContextAllowed(context), false, JSON.stringify(context));
    assert.equal(ugmuCheckoutContextAllowed(context), false, JSON.stringify(context));
    assert.equal(ugmuTrialContextAllowed(context), false, JSON.stringify(context));
  }

  assert.equal(ugmuAccessContextAllowed(valid, "unknown-capability"), false);
});
