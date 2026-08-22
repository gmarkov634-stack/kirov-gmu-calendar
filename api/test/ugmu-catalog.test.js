import assert from "node:assert/strict";
import test from "node:test";

import { UGMU_CATALOG, ugmuCatalogGroups } from "../src/ugmu-catalog.mjs";
import { UGMU_COURSE1_GROUPS } from "../src/ugmu-course1-access-policy.mjs";

test("UGMU passive catalog describes the current reviewed medicine scope", () => {
  assert.equal(UGMU_CATALOG.university.id, "ugmu");
  assert.equal(UGMU_CATALOG.faculties.length, 1);

  const faculty = UGMU_CATALOG.faculties[0];
  assert.equal(faculty.name, "Лечебно-профилактический факультет");
  assert.equal(faculty.programs.length, 1);

  const program = faculty.programs[0];
  assert.equal(program.id, "medicine");
  assert.equal(program.code, "31.05.01");
  assert.equal(program.name, "Лечебное дело");
  assert.equal(program.durationYears, 6);
  assert.deepEqual(program.courses.map((course) => course.number), [1]);
});

test("UGMU passive catalog exactly mirrors the existing 50-group authority", () => {
  const passiveGroups = ugmuCatalogGroups();
  assert.equal(passiveGroups.length, 50);

  const projected = passiveGroups.map(({ university, program, course, stream, groupCode, groupId }) => ({
    university,
    program,
    course,
    stream,
    groupCode,
    groupId,
  }));

  assert.deepEqual(projected, UGMU_COURSE1_GROUPS);
});

test("UGMU passive catalog contains no commerce or publication authority", () => {
  const serialized = JSON.stringify(UGMU_CATALOG).toLowerCase();
  for (const forbidden of ["checkout", "trial", "sales", "payment", "publicics", "publicationallowed"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
