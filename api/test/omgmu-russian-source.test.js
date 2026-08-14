import assert from "node:assert/strict";
import test from "node:test";

import { selectOmgmuRussianSourceText } from "../src/adapters/omgmu/text-input.mjs";

test("selects Russian part from a bilingual ОмГМУ source", () => {
  const source = [
    "SCHEDULE OF CLASSES\nMONDAY\n08.00-10.25 Histology",
    "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nПОНЕДЕЛЬНИК\n08.00-10.25 Гистология",
  ].join("\f");
  const selected = selectOmgmuRussianSourceText(source);
  assert.match(selected, /РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ/);
  assert.match(selected, /Гистология/);
  assert.doesNotMatch(selected, /SCHEDULE OF CLASSES/);
  assert.doesNotMatch(selected, /Histology/);
});

test("keeps Russian continuation pages", () => {
  const source = [
    "SCHEDULE CONDUCTED IN THE FORM OF CONTACT WORK\n1 cycle",
    "РАСПИСАНИЕ ЦИКЛОВЫХ ЗАНЯТИЙ\nru\n1 цикл: 07.05-31.07",
    "2 цикл: 29.05-30.07\nДисциплина Время К.дн. 485 486",
  ].join("\f");
  const selected = selectOmgmuRussianSourceText(source);
  assert.match(selected, /1 цикл/);
  assert.match(selected, /2 цикл/);
  assert.match(selected, /К\.дн/);
  assert.doesNotMatch(selected, /SCHEDULE CONDUCTED/);
});

test("accepts an unambiguously Russian-only source without a schedule heading", () => {
  const source = "ПОНЕДЕЛЬНИК\nДисциплина Время К.дн.\nПедиатрия 08.20-10.00";
  assert.equal(selectOmgmuRussianSourceText(source), source);
});

test("fails closed for an English-only source", () => {
  assert.throws(
    () => selectOmgmuRussianSourceText("SCHEDULE OF CLASSES\nMONDAY\nDiscipline Time"),
    /Russian ОмГМУ source part not found/,
  );
});

test("stops before a later English source part", () => {
  const source = [
    "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\nПОНЕДЕЛЬНИК\nГистология",
    "продолжение русской таблицы\nВТОРНИК\nБиохимия",
    "SCHEDULE OF CLASSES\nMONDAY\nHistology",
  ].join("\f");
  const selected = selectOmgmuRussianSourceText(source);
  assert.match(selected, /Биохимия/);
  assert.doesNotMatch(selected, /SCHEDULE OF CLASSES/);
  assert.doesNotMatch(selected, /Histology/);
});
