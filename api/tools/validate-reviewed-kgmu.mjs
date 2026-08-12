import fs from "node:fs";
import { validateReviewedBundle } from "../src/adapters/kgmu/reviewed-bundle.mjs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node api/tools/validate-reviewed-kgmu.mjs <bundle.json> [...]");
  process.exit(2);
}

for (const filename of files) {
  const input = JSON.parse(fs.readFileSync(filename, "utf8"));
  const result = validateReviewedBundle(input);
  console.log(JSON.stringify({
    file: filename,
    status: result.qa.status,
    program: result.program,
    course: result.course,
    academicYear: result.academicYear,
    semester: result.semester,
    groupCount: result.qa.groupCount,
    eventCount: result.qa.eventCount,
    sourceSha256: result.source.sha256,
  }));
}
