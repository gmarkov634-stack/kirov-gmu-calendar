import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __medicine2NormalizationTest,
  normalizeIzhgmuMedicine2ClassStructure,
  normalizeIzhgmuMedicine2Combined,
} from '../src/adapters/izhgmu/medicine2-normalization.mjs';

test('strictly normalizes four-component hyphen clock ranges', () => {
  assert.equal(__medicine2NormalizationTest.normalizeHyphenClockRange('8-30-10-05'), '08.30-10.05');
  assert.equal(__medicine2NormalizationTest.normalizeHyphenClockRange('08-30-10-05'), '08.30-10.05');
  assert.equal(__medicine2NormalizationTest.normalizeHyphenClockRange('24-30-10-05'), null);
  assert.equal(__medicine2NormalizationTest.normalizeHyphenClockRange('8-30-8-05'), null);
  assert.equal(__medicine2NormalizationTest.normalizeHyphenClockRange('кафедра-8-30-10-05'), null);
});

test('class normalization only changes time-column cells with exact proven syntax', () => {
  const source = {
    sheets: [{
      name: 'расписание',
      cells: [
        { ref: 'B25', row: 25, col: 2, value: '8-30-10-05' },
        { ref: 'C25', row: 25, col: 3, value: '8-30-10-05' },
        { ref: 'B26', row: 26, col: 2, value: '08.30-10.05' },
      ],
    }],
  };
  const result = normalizeIzhgmuMedicine2ClassStructure(source);
  assert.equal(result.sheets[0].cells[0].value, '08.30-10.05');
  assert.equal(result.sheets[0].cells[1].value, '8-30-10-05');
  assert.equal(result.sheets[0].cells[2].value, '08.30-10.05');
});

test('assessment summary is annotation, matching count row is safe, mismatch stays blocked', () => {
  const result = normalizeIzhgmuMedicine2Combined({
    profile: 'IZH-WEEKLY+LECTURE',
    series: [],
    reviewRequired: [
      {
        warning: 'stream_wide_class_block_unmapped',
        warnings: ['stream_wide_class_block_unmapped'],
        discipline: 'Зачеты: Физическая культура и спорт; НИР',
        rawSource: 'Зачеты: Физическая культура и спорт; НИР',
        weekday: null,
        startTime: null,
        endTime: null,
        references: [{ role: 'class_block', range: 'расписание!B28' }],
        ruleIds: ['IZH-L08'],
      },
      {
        warning: 'declared_lecture_count_scope_ambiguous',
        warnings: ['declared_lecture_count_scope_ambiguous'],
        status: 'needs_review',
        discipline: 'Физвоспитание',
        declaredCount: 15,
        dates: Array.from({ length: 15 }, (_, index) => `2026-03-${String(index + 1).padStart(2, '0')}`),
        ruleIds: ['IZH-L05'],
      },
      {
        warning: 'declared_lecture_count_scope_ambiguous',
        warnings: ['declared_lecture_count_scope_ambiguous'],
        status: 'needs_review',
        discipline: 'Физвоспитание',
        declaredCount: 14,
        dates: Array.from({ length: 13 }, (_, index) => `2026-04-${String(index + 1).padStart(2, '0')}`),
        ruleIds: ['IZH-L05'],
      },
    ],
    deferred: [{
      reason: 'stream_wide_class_block_unmapped',
      value: 'Зачеты: Физическая культура и спорт; НИР',
      weekday: null,
      startTime: null,
      endTime: null,
    }],
    unresolvedChoices: [],
    sourceCoverage: {
      unmapped: [{ value: 'Зачеты: Физическая культура и спорт; НИР', weekday: null, startTime: null, endTime: null }],
    },
  });

  assert.equal(result.reviewRequired.length, 2);
  const safeCount = result.reviewRequired.find((item) => item.declaredCount === 15);
  const mismatch = result.reviewRequired.find((item) => item.declaredCount === 14);
  assert.equal(safeCount.status, 'ok');
  assert.equal(safeCount.warning, null);
  assert.equal(safeCount.declaredCountScope, 'row');
  assert.equal(mismatch.warning, 'declared_lecture_count_mismatch');
  assert.equal(mismatch.status, 'needs_review');
  assert.equal(result.deferred.length, 0);
  assert.equal(result.sourceCoverage.unmapped.length, 0);
  assert.equal(result.informationalAnnotations.length, 1);
  assert.equal(result.publishable, false);
});
