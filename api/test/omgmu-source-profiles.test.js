import assert from "node:assert/strict";
import test from "node:test";
import {
  OMG_SOURCE_PROFILES,
  assertOmgmuSourceProfile,
  detectOmgmuSourceProfile,
  rulesForOmgmuSourceProfile,
} from "../src/adapters/omgmu/source-profiles.mjs";

const weekly = `
SPRING SEMESTER 2025 / 2026 ACADEMIC YEAR
1101 1102 1103 1104 1105 1106
Monday
08.00-10.25 Histology, 18 cl.: 06.04-03.08
Tuesday
11.00-12.40 Biochemistry, 8 lectures: 07.04-02.06
Wednesday
Thursday
Friday
Saturday
08.00-10.25 Pathophysiology, 16 cl.: 11.04-01.08
`;

const lectures = `
SCHEDULE CONDUCTED IN THE FORM OF CONTACT WORK
4 COURSE
LECTURES
*08.20-10.00 Faculty therapy, occupational diseases, 11 lectures: 07.05-21.05 (without Saturday)
MONDAY
08.00-09.40 Neurology, medical genetics, neurosurgery, 5 lectures: 06.04-04.05
TUESDAY
08.20-10.00 Fundamentals of reproductology, 5 lectures: 07.04-05.05
WEDNESDAY
08.20-10.00 Faculty surgery, urology, 5 lectures: 08.04-06.05
THURSDAY
FRIDAY
`;

const cycles = `
SCHEDULE CONDUCTED IN THE FORM OF CONTACT WORK
1 cycle: 07.05-31.07 - without Saturday
Discipline Time N. of d. 485 486
Faculty therapy, occupational diseases 08.20-10.00 11 07.05-21.05 (lectures)
2 cycle: 29.05-30.07 - without Saturday
Discipline Time N. of d. 485 486
Pediatrics 12.50-16.00 10 30.06-13.07
`;

const combinedRotation = `
SCHEDULE CONDUCTED IN THE FORM OF CONTACT WORK
5 COURSE
Auditorium classes: 06.04-07.08 - without Saturday
Discipline Time N. of d 585
Psychiatry, medical psychology 08.20-10.00 6 06.04-13.04 (lectures)
Psychiatry, medical psychology 10.40-13.50 8 06.04-15.04 (cycles)
`;

test("classifies the four current ОмГМУ structural profiles", () => {
  assert.equal(detectOmgmuSourceProfile(weekly).profile, OMG_SOURCE_PROFILES.WEEKLY_GRID);
  assert.equal(detectOmgmuSourceProfile(lectures).profile, OMG_SOURCE_PROFILES.COURSE_LECTURE_LIST);
  assert.equal(detectOmgmuSourceProfile(cycles).profile, OMG_SOURCE_PROFILES.CYCLE_ROTATION_GRID);
  assert.equal(detectOmgmuSourceProfile(combinedRotation).profile, OMG_SOURCE_PROFILES.COMBINED_ROTATION_TABLE);
});

test("fails closed for a source whose structure is not recognized", () => {
  const result = detectOmgmuSourceProfile("Schedule 4 course, some dates 06.04-08.08");
  assert.equal(result.status, "needs_review");
  assert.equal(result.profile, null);
  assert.throws(
    () => assertOmgmuSourceProfile("unknown", OMG_SOURCE_PROFILES.WEEKLY_GRID),
    /profile mismatch/,
  );
});

test("rule registry scopes profile-specific rules", () => {
  const weeklyRules = rulesForOmgmuSourceProfile(OMG_SOURCE_PROFILES.WEEKLY_GRID);
  const lectureRules = rulesForOmgmuSourceProfile(OMG_SOURCE_PROFILES.COURSE_LECTURE_LIST);
  const cycleRules = rulesForOmgmuSourceProfile(OMG_SOURCE_PROFILES.CYCLE_ROTATION_GRID);
  const combinedRules = rulesForOmgmuSourceProfile(OMG_SOURCE_PROFILES.COMBINED_ROTATION_TABLE);

  for (const rules of [weeklyRules, lectureRules, cycleRules, combinedRules]) {
    assert.ok(rules.includes("O01"));
    assert.ok(rules.includes("O48"));
    assert.ok(rules.includes("O54"));
    assert.ok(rules.includes("O55"));
    assert.ok(rules.includes("O56"));
    assert.ok(rules.includes("O64"));
  }
  assert.ok(weeklyRules.includes("O03"));
  assert.ok(weeklyRules.includes("O57"));
  assert.ok(weeklyRules.includes("O58"));
  assert.ok(weeklyRules.includes("O59"));
  assert.ok(weeklyRules.includes("O60"));
  assert.ok(weeklyRules.includes("O61"));
  assert.ok(weeklyRules.includes("O62"));
  assert.ok(weeklyRules.includes("O63"));
  assert.ok(weeklyRules.includes("O65"));
  assert.ok(!weeklyRules.includes("O19"));
  assert.ok(!weeklyRules.includes("O66"));
  assert.ok(!weeklyRules.includes("O67"));
  assert.ok(!weeklyRules.includes("O68"));
  assert.ok(!weeklyRules.includes("O69"));
  assert.ok(!weeklyRules.includes("O70"));
  assert.ok(!weeklyRules.includes("O71"));

  assert.ok(!lectureRules.includes("O03"));
  assert.ok(!lectureRules.includes("O57"));
  assert.ok(lectureRules.includes("O31"));
  assert.ok(lectureRules.includes("O58"));
  assert.ok(lectureRules.includes("O61"));
  assert.ok(lectureRules.includes("O66"));
  assert.ok(lectureRules.includes("O67"));
  assert.ok(lectureRules.includes("O68"));
  assert.ok(lectureRules.includes("O71"));
  assert.ok(!lectureRules.includes("O59"));
  assert.ok(!lectureRules.includes("O60"));
  assert.ok(!lectureRules.includes("O62"));
  assert.ok(!lectureRules.includes("O63"));
  assert.ok(!lectureRules.includes("O65"));
  assert.ok(!lectureRules.includes("O19"));
  assert.ok(!lectureRules.includes("O69"));
  assert.ok(!lectureRules.includes("O70"));

  assert.ok(cycleRules.includes("O19"));
  assert.ok(!cycleRules.includes("O31"));
  assert.ok(!cycleRules.includes("O57"));
  assert.ok(!cycleRules.includes("O58"));
  assert.ok(!cycleRules.includes("O59"));
  assert.ok(!cycleRules.includes("O60"));
  assert.ok(!cycleRules.includes("O61"));
  assert.ok(!cycleRules.includes("O62"));
  assert.ok(!cycleRules.includes("O63"));
  assert.ok(!cycleRules.includes("O65"));
  assert.ok(!cycleRules.includes("O66"));
  assert.ok(!cycleRules.includes("O67"));
  assert.ok(!cycleRules.includes("O68"));
  assert.ok(!cycleRules.includes("O69"));
  assert.ok(!cycleRules.includes("O70"));
  assert.ok(!cycleRules.includes("O71"));
  assert.ok(cycleRules.includes("O53"));

  assert.ok(!combinedRules.includes("O19"));
  assert.ok(!combinedRules.includes("O53"));
  assert.ok(!combinedRules.includes("O57"));
  assert.ok(!combinedRules.includes("O58"));
  assert.ok(!combinedRules.includes("O59"));
  assert.ok(!combinedRules.includes("O60"));
  assert.ok(!combinedRules.includes("O61"));
  assert.ok(!combinedRules.includes("O62"));
  assert.ok(!combinedRules.includes("O63"));
  assert.ok(!combinedRules.includes("O65"));
  assert.ok(!combinedRules.includes("O66"));
  assert.ok(!combinedRules.includes("O67"));
  assert.ok(!combinedRules.includes("O68"));
  assert.ok(combinedRules.includes("O69"));
  assert.ok(combinedRules.includes("O70"));
  assert.ok(!combinedRules.includes("O71"));
});
