import assert from 'node:assert/strict';
import test from 'node:test';
import { personalizeIzhgmuWeeklyLectureElective } from '../src/adapters/izhgmu/weekly-lecture-personalization.mjs';

function parsed() {
  const ordinary = {
    discipline: 'Биоэтика', choiceRequired: false, status: 'ok', warnings: [], ruleIds: ['IZH-L01'], dates: ['2026-02-02'],
  };
  const cultureA = {
    discipline: 'Культурология', choiceRequired: true, status: 'deferred', warning: 'elective_choice_required', warnings: ['elective_choice_required'], ruleIds: ['IZH-L07'], dates: ['2026-02-03', '2026-02-17'],
  };
  const cultureB = {
    discipline: 'Культурология', choiceRequired: true, status: 'deferred', warning: 'elective_choice_required', warnings: ['elective_choice_required'], ruleIds: ['IZH-L07'], dates: ['2026-03-03'],
  };
  const chemistry = {
    discipline: 'Медицинская химия', choiceRequired: true, status: 'deferred', warning: 'elective_choice_required', warnings: ['elective_choice_required'], ruleIds: ['IZH-L07'], dates: ['2026-02-10'],
  };
  return {
    profile: 'IZH-LECTURE',
    series: [ordinary, cultureA, cultureB, chemistry],
    safeSeries: [ordinary],
    choiceRequired: {
      warning: 'elective_choice_required',
      options: [cultureA, cultureB, chemistry],
    },
  };
}

test('unselected elective is a valid personalization state and stays hidden', () => {
  const result = personalizeIzhgmuWeeklyLectureElective(parsed());
  assert.equal(result.choiceRequired, null);
  assert.deepEqual(result.safeSeries.map((item) => item.discipline), ['Биоэтика']);
  assert.equal(result.personalization.elective.state, 'unselected');
  assert.equal(result.personalization.elective.displayPolicy, 'hidden_until_selected');
  assert.deepEqual(result.personalization.elective.availableOfficialDisciplines, ['Культурология', 'Медицинская химия']);
});

test('selected elective materializes every official row under its real name', () => {
  const result = personalizeIzhgmuWeeklyLectureElective(parsed(), { selectedDiscipline: 'Культурология' });
  const chosen = result.safeSeries.filter((item) => item.discipline === 'Культурология');
  assert.equal(result.choiceRequired, null);
  assert.equal(chosen.length, 2);
  assert.equal(chosen.reduce((count, item) => count + item.dates.length, 0), 3);
  assert.ok(chosen.every((item) => item.choiceRequired === false && item.status === 'ok'));
  assert.ok(chosen.every((item) => item.personalization.officialDiscipline === 'Культурология'));
  assert.equal(result.personalization.elective.displayPolicy, 'official_name');
});

test('selection must be source-bound and cannot invent a discipline', () => {
  assert.throws(
    () => personalizeIzhgmuWeeklyLectureElective(parsed(), { selectedDiscipline: 'Не существующая дисциплина' }),
    (error) => error?.code === 'IZH_ELECTIVE_SELECTION_NOT_IN_SOURCE',
  );
});
