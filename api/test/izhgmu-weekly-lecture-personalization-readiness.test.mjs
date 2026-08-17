import test from 'node:test';
import assert from 'node:assert/strict';
import { assessIzhgmuWeeklyLecturePersonalizationReadiness } from '../src/adapters/izhgmu/weekly-lecture-personalization-readiness.mjs';

function parsed({ extraReview = false } = {}) {
  return {
    profile: 'IZH-WEEKLY+LECTURE',
    reviewRequired: extraReview ? [{ warning: 'lecture_end_time_slot_missing', references: [{ range: 'lecture!B8' }] }] : [],
    deferred: [],
    unresolvedChoices: [{
      kind: 'elective_choice',
      warning: 'elective_choice_required',
      blocks: [{ ref: 'C31' }, { ref: 'C32' }, { ref: 'C33' }],
      options: Array.from({ length: 8 }, (_, index) => ({ discipline: `Option ${index + 1}` })),
    }],
  };
}

function catalog({ refs = ['C31', 'C32'], practiceRefs = ['C33'] } = {}) {
  return {
    version: 1,
    electives: [{
      id: 'elective-1',
      sourceBlockRefs: refs,
      practiceBlockRefs: practiceRefs,
      options: Array.from({ length: 8 }, (_, index) => ({
        id: `option-${index + 1}`,
        officialDiscipline: `Option ${index + 1}`,
        events: [{ timing: { date: '2026-02-14' } }],
      })),
    }],
  };
}

test('only source-bound elective choice blockers can become personalization-ready', () => {
  const result = assessIzhgmuWeeklyLecturePersonalizationReadiness(parsed(), catalog());
  assert.equal(result.contentReady, true);
  assert.equal(result.productionAuthorized, false);
  assert.equal(result.personalizationRequired, true);
  assert.equal(result.electiveBlocks, 1);
  assert.equal(result.optionCount, 8);
});

test('any non-elective blocker keeps IzhGMU content fail-closed', () => {
  assert.throws(
    () => assessIzhgmuWeeklyLecturePersonalizationReadiness(parsed({ extraReview: true }), catalog()),
    (error) => error.code === 'IZH_PERSONALIZATION_CONTENT_BLOCKED',
  );
});

test('catalog must cover the exact choice source blocks including practice rows', () => {
  assert.throws(
    () => assessIzhgmuWeeklyLecturePersonalizationReadiness(parsed(), catalog({ practiceRefs: [] })),
    (error) => error.code === 'IZH_PERSONALIZATION_CATALOG_MAPPING_AMBIGUOUS',
  );
});

test('empty or incomplete catalog cannot make content ready', () => {
  const incomplete = catalog();
  incomplete.electives[0].options[0].events = [];
  assert.throws(
    () => assessIzhgmuWeeklyLecturePersonalizationReadiness(parsed(), incomplete),
    (error) => error.code === 'IZH_PERSONALIZATION_CATALOG_OPTION_INVALID',
  );
});
