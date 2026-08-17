import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyIzhgmuScheduleContext,
  classifyIzhgmuLabel,
  discoverIzhgmuSources,
} from '../src/adapters/izhgmu/discover.mjs';

test('malformed label academic year is recovered only from a valid consecutive page context', () => {
  const source = {
    label: 'Расписание занятий для студентов 1 курса 2 поток лечебного факультета на весенний семестр 2025-2025 уч.г.',
    url: 'https://www.igma.ru/files/m1s2.xlsx',
    ...classifyIzhgmuLabel('Расписание занятий для студентов 1 курса 2 поток лечебного факультета на весенний семестр 2025-2025 уч.г.'),
  };

  const [recovered] = applyIzhgmuScheduleContext([source], {
    academicYear: '2025-2026',
    term: 'spring',
  });
  assert.equal(recovered.labelAcademicYear, '2025-2025');
  assert.equal(recovered.academicYear, '2025-2026');
  assert.equal(recovered.academicYearSource, 'schedule-context-recovery');
  assert.deepEqual(recovered.warnings, [
    'malformed-academic-year',
    'academic-year-recovered-from-schedule-context',
  ]);

  const [notRecovered] = applyIzhgmuScheduleContext([source], {
    academicYear: '2025-2025',
    term: 'spring',
  });
  assert.equal(notRecovered.academicYear, '2025-2025');
  assert.equal(notRecovered.labelAcademicYear, undefined);
  assert.equal(notRecovered.academicYearSource, undefined);
});

test('valid source label metadata is left unchanged', () => {
  const source = {
    label: 'Расписание занятий для студентов 1 курса 1 поток лечебного факультета на весенний семестр 2025-2026 уч.г.',
    url: 'https://www.igma.ru/files/m1s1.xlsx',
    ...classifyIzhgmuLabel('Расписание занятий для студентов 1 курса 1 поток лечебного факультета на весенний семестр 2025-2026 уч.г.'),
  };
  const [result] = applyIzhgmuScheduleContext([source], { academicYear: '2025-2026', term: 'spring' });
  assert.deepEqual(result, source);
});

test('discovery preserves the malformed raw label year while exposing the recovered effective year', async () => {
  const html = `
    <h3>Лечебный факультет - Весна 2025-2026</h3>
    <a href="/files/m1s2.xlsx">Расписание занятий для студентов 1 курса 2 поток лечебного факультета на весенний семестр 2025-2025 уч.г.</a>
  `;
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    text: async () => html,
  });

  const manifest = await discoverIzhgmuSources({ fetchFn });
  assert.equal(manifest.validation.status, 'ok');
  assert.equal(manifest.scheduleContext.academicYear, '2025-2026');
  assert.equal(manifest.sources.length, 1);
  assert.equal(manifest.sources[0].academicYear, '2025-2026');
  assert.equal(manifest.sources[0].labelAcademicYear, '2025-2025');
  assert.equal(manifest.sources[0].academicYearSource, 'schedule-context-recovery');
  assert.match(manifest.validation.warnings.join('\n'), /malformed-academic-year/);
  assert.match(manifest.validation.warnings.join('\n'), /academic-year-recovered-from-schedule-context/);
  assert.doesNotMatch(manifest.validation.warnings.join('\n'), /academic year differs from page context/);
});
