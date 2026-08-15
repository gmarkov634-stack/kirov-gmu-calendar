import assert from "node:assert/strict";
import test from "node:test";
import { buildCourseLectureListCanonicalBatch } from "../src/adapters/omgmu/course-lecture-list.mjs";
import { parseFourthCourseLectures } from "../src/adapters/omgmu/fourth-parser.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

function adapterOptions() {
  return { metadata: { academicYear: "2025/2026", semester: "spring", facultyCode: "medicine-international", facultyName: "Лечебное дело для иностранных граждан", course: 4, groupCode: "485", period: { start_date: "2026-04-06", end_date: "2026-08-08", week1_start_date: "2026-04-06" } }, source: { fileName: "4lek.pdf", fileHash: "test-o66-o68" } };
}

test("O66 ambiguous physical continuation becomes needs_review instead of being silently trusted", () => {
  const source = `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nЛЕКЦИИ\nПОНЕДЕЛЬНИК\n11.00-12.40 Педиатрия, 1 лекция: 13.04\nнеоднозначная строка без структурного признака продолжения`;
  const records = parseFourthCourseLectures(source);
  assert.equal(records.length, 1); assert.equal(records[0].status, "needs_review"); assert.ok(records[0].ruleIds.includes("O66")); assert.match(records[0].warnings.join("\n"), /O66/);
  const batch = buildCourseLectureListCanonicalBatch(source, adapterOptions()); assert.equal(batch.events[0].parse.status, "needs_review");
  assert.throws(() => prepareSchedulePublication(batch), (error) => error.code === "SCHEDULE_NOT_PUBLISHABLE" && error.stage === "input");
});

test("O66 keeps confirmed location continuation publishable", () => {
  const source = `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nЛЕКЦИИ\nЧЕТВЕРГ\n11.20-13.00 Инфекционные болезни у детей, 4 лекции: 09.04-30.04 - БУЗОО «ДКБ № 3», инф.\nстационар, ул. 19 Партсъезда, 16`;
  const records = parseFourthCourseLectures(source);
  assert.equal(records[0].status, "ok"); assert.ok(records[0].ruleIds.includes("O66")); assert.ok(records[0].ruleIds.includes("O67"));
  assert.equal(records[0].location, "БУЗОО «ДКБ № 3», инф. стационар, ул. 19 Партсъезда, 16");
});

test("O66/O67 accept a completed date range followed by a physical auditorium line", () => {
  const source = `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nЛЕКЦИИ\nЧЕТВЕРГ\n14.20-16.00 Коммуникативные навыки врача в профессиональном общении, 3 лекции: 09.04-23.04 –\n229 ауд. ГК. ул.Ленина,12`;
  const records = parseFourthCourseLectures(source);
  assert.equal(records[0].status, "ok"); assert.deepEqual(records[0].dates, ["2026-04-09", "2026-04-16", "2026-04-23"]); assert.equal(records[0].location, "229 ауд. ГК. ул.Ленина,12");
});

test("O67 accepts irregular spacing only for an explicit location after the completed date expression", () => {
  const source = `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nЛЕКЦИИ\nВТОРНИК\n11.20-13.00 Акушерство и гинекология, 4 лекции:07.04-28.04- БУЗОО «КРД № 6»,ул. Перелета,3`;
  const records = parseFourthCourseLectures(source);
  assert.equal(records[0].status, "ok"); assert.deepEqual(records[0].dates, ["2026-04-07", "2026-04-14", "2026-04-21", "2026-04-28"]); assert.equal(records[0].location, "БУЗОО «КРД № 6»,ул. Перелета,3");
});

test("O67 leaves an ambiguous non-location suffix out of location without guessing", () => {
  const source = `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nЛЕКЦИИ\nПОНЕДЕЛЬНИК\n11.00-12.40 Педиатрия, 1 лекция: 13.04 - кафедра`;
  const records = parseFourthCourseLectures(source);
  assert.equal(records[0].status, "warning"); assert.equal(records[0].location, ""); assert.ok(records[0].ruleIds.includes("O67"));
  const prepared = prepareSchedulePublication(buildCourseLectureListCanonicalBatch(source, adapterOptions())); assert.equal(prepared.inputQa.publishable, true); assert.equal(prepared.outputQa.publishable, true);
});

test("O68 keeps same weekday/time records separate when their resolved dates do not overlap", () => {
  const source = `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nЛЕКЦИИ\nПОНЕДЕЛЬНИК\n11.00-12.40 Акушерство и гинекология, 1 лекция: 06.04\n11.00-12.40 Педиатрия, 3 лекции: 13.04-27.04`;
  const records = parseFourthCourseLectures(source); assert.equal(records.length, 2); assert.ok(records.every((record) => record.status === "ok"));
});

test("O68 overlapping different disciplines on the same resolved date/time blocks common QA", () => {
  const source = `РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nЛЕКЦИИ\nПОНЕДЕЛЬНИК\n11.00-12.40 Акушерство и гинекология, 1 лекция: 13.04\n11.00-12.40 Педиатрия, 1 лекция: 13.04`;
  const records = parseFourthCourseLectures(source); assert.equal(records.length, 2); assert.ok(records.every((record) => record.status === "needs_review")); assert.ok(records.every((record) => /O68/.test(record.warnings.join("\n"))));
  const batch = buildCourseLectureListCanonicalBatch(source, adapterOptions()); assert.ok(batch.events.every((event) => event.parse.status === "needs_review"));
  assert.throws(() => prepareSchedulePublication(batch), (error) => error.code === "SCHEDULE_NOT_PUBLISHABLE" && error.stage === "input");
});
