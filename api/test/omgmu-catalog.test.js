import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOmgmuCatalog, extractGroupCodes } from "../src/adapters/omgmu/catalog.mjs";

test("extracts group headers and ignores dates, times and room numbers", () => {
  const text = `
SPRING SEMESTER 2025 / 2026 ACADEMIC YEAR
1101 1102 1103 1104 1105 1106
11.00-12.40 lecture, aud. 229
`;
  assert.deepEqual(extractGroupCodes(text), ["1101", "1102", "1103", "1104", "1105", "1106"]);
});

test("extracts a single group from a cycle table heading", () => {
  assert.deepEqual(extractGroupCodes("Discipline Time N. of d 585\n08.20-10.00"), ["585"]);
});

test("builds a catalog and combines shared lecture and cycle parts", async () => {
  const textDir = await fs.mkdtemp(path.join(os.tmpdir(), "omgmu-catalog-"));
  await fs.writeFile(path.join(textDir, "01_medicine-international_course-1_stream-1_combined.txt"), "1101 1102 1103");
  await fs.writeFile(path.join(textDir, "06_medicine-international_course-4_lectures.txt"), "LECTURES\nno groups here");
  await fs.writeFile(path.join(textDir, "07_medicine-international_course-4_cycles.txt"), "Discipline Time N. of d 485 486");
  const catalog = await buildOmgmuCatalog({ textDir });
  assert.equal(catalog.groupCount, 5);
  assert.deepEqual(catalog.groups.map((item) => item.code), ["1101", "1102", "1103", "485", "486"]);
  const fourth = catalog.offerings.find((item) => item.course === 4);
  assert.deepEqual(fourth.parts, ["cycles", "lectures"]);
  assert.deepEqual(fourth.groupCodes, ["485", "486"]);
});
