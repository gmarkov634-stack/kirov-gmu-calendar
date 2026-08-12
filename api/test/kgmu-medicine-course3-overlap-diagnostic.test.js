import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseMedicineCourse3RWorkbookReviewed } from "../src/adapters/kgmu/medicine-course3-r-reviewed.mjs";

function loadFixture() {
  const encoded = fs.readFileSync(new URL("./fixtures/kgmu-medicine-course3-stream2-2025-26.workbook.json.gz.b64", import.meta.url), "utf8").trim();
  return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

test("diagnose MED3 remaining overlaps", () => {
  const result = parseMedicineCourse3RWorkbookReviewed(loadFixture(), {
    university: "kgmu",
    program: "medicine",
    course: 3,
    academicYear: "2025/26",
    semester: 2,
  });
  const eventById = new Map(result.schedules.flatMap((schedule) => schedule.events).map((event) => [event.id, event]));
  const details = (result.qa.remainingOverlaps || []).map((overlap) => {
    const describe = (id) => {
      const event = eventById.get(id);
      return event ? {
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        kind: event.kind,
        dateMode: event.dateMode,
        sourceCell: event.sourceCell,
        sourceRange: event.sourceRange,
      } : null;
    };
    return { group: overlap.group, first: describe(overlap.event1), second: describe(overlap.event2) };
  });
  console.log("KGMU MED3 overlap details", JSON.stringify(details));
  assert.equal(details.length, result.qa.remainingOverlaps.length);
});
