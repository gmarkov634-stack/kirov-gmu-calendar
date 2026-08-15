import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOmgmuCatalog, extractGroupCodes } from "../src/adapters/omgmu/catalog.mjs";

test("extracts group headers and ignores dates, times and room numbers", () => {
  const text = `\nSPRING SEMESTER 2025 / 2026 ACADEMIC YEAR\n1101 1102 1103 1104 1105 1106\n11.00-12.40 lecture, aud. 229\n`;
  assert.deepEqual(extractGroupCodes(text), ["1101", "1102", "1103", "1104", "1105", "1106"]);
});

test("extracts a single group from a cycle table heading", () => {
  assert.deepEqual(extractGroupCodes("Discipline Time N. of d 585\n08.20-10.00"), ["585"]);
});

test("builds a catalog with structural source profiles", async () => {
  const textDir = await fs.mkdtemp(path.join(os.tmpdir(), "omgmu-catalog-"));
  await fs.writeFile(path.join(textDir, "01_medicine-international_course-1_stream-1_combined.txt"), "1101 1102 1103\nMonday\nTuesday\nWednesday\nThursday\nFriday\n");
  await fs.writeFile(path.join(textDir, "06_medicine-international_course-4_lectures.txt"), "LECTURES\nMONDAY\nNeurology, 5 lectures: 06.04-04.05\nTUESDAY\nPediatrics, 5 lectures: 07.04-05.05\nWEDNESDAY\nTHURSDAY\nFRIDAY\n");
  await fs.writeFile(path.join(textDir, "07_medicine-international_course-4_cycles.txt"), "1 cycle: 07.05-31.07 - without Saturday\nDiscipline Time N. of d 485 486\nFaculty therapy 07.05-21.05 (lectures)\n2 cycle: 29.05-30.07 - without Saturday\n");
  const catalog = await buildOmgmuCatalog({ textDir });
  assert.equal(catalog.groupCount, 5);
  assert.equal(catalog.sourceProfileCount, 3);
  assert.deepEqual(catalog.groups.map((item) => item.code), ["1101", "1102", "1103", "485", "486"]);
  assert.deepEqual(catalog.sources.map((item) => item.sourceProfile), ["weekly_grid", "course_lecture_list", "cycle_rotation_grid"]);
  assert.ok(catalog.sources.every((item) => item.applicableRules.includes("O01")));
  const fourth = catalog.offerings.find((item) => item.course === 4);
  assert.deepEqual(fourth.parts, ["cycles", "lectures"]);
  assert.deepEqual(fourth.groupCodes, ["485", "486"]);
  assert.deepEqual(fourth.sourceProfiles, ["course_lecture_list", "cycle_rotation_grid"]);
});
