import assert from 'node:assert/strict';
import test from 'node:test';

import { expandExplicitDecisionManifest } from '../src/explicit-decisions.js';

function manifest(overrides = {}) {
  return {
    schema: 'kgmu-explicit-semantic-decisions-v3',
    semanticDecisionMode: 'operator-authored-explicit',
    sheetName: '3 леч.1',
    groupTable: ['301'],
    dateTable: ['2026-09-15'],
    disciplineTable: ['Обычная дисциплина', 'Молекулярные механизмы в патологии человека'],
    lessonTypeTable: ['practice'],
    locationTable: [''],
    logicalSourceCellCount: 1,
    decisions: [['B15#s1', '1', '1', '08:00', '10:25', 1, 0, 0]],
    decisionCount: 1,
    ...overrides
  };
}

const context = {
  universityId: 'kirov-gmu',
  academicPeriodId: '2026-2027-semester-1',
  sourceId: 'medicine-301-310'
};

test('explicit decisions attach elective selection metadata by discipline without changing tuple shape', () => {
  const events = expandExplicitDecisionManifest(manifest({
    selectionMetadataByDisciplineIndex: {
      '1': {
        selectionGroupId: 'medicine-3-choice-discipline-2026-s1',
        selectionOptionId: 'molecular-pathology'
      }
    }
  }), context);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].selection, {
    selectionGroupId: 'medicine-3-choice-discipline-2026-s1',
    selectionOptionId: 'molecular-pathology'
  });
  assert.equal(events[0].discipline, 'Молекулярные механизмы в патологии человека');
});

test('existing manifests remain valid when selection metadata is absent', () => {
  const [event] = expandExplicitDecisionManifest(manifest(), context);
  assert.equal('selection' in event, false);
});

test('selection metadata rejects unknown discipline indexes and empty option ids', () => {
  assert.throws(() => expandExplicitDecisionManifest(manifest({
    selectionMetadataByDisciplineIndex: {
      '9': { selectionGroupId: 'choice', selectionOptionId: 'option' }
    }
  }), context), /outside its table/);

  assert.throws(() => expandExplicitDecisionManifest(manifest({
    selectionMetadataByDisciplineIndex: {
      '1': { selectionGroupId: 'choice', selectionOptionId: '' }
    }
  }), context), /selectionOptionId must be a non-empty string/);
});
