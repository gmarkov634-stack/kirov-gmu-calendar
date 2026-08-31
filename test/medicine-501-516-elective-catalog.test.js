import assert from 'node:assert/strict';
import test from 'node:test';

import { buildElectiveCatalog } from '../tools/generate-elective-catalog.mjs';

const PERIOD = '2026-2027-semester-1';
const PE_SELECTION = 'medicine-5-physical-education-stream-2026-s1';

test('medicine 501-516 exposes physical education stream as personalization choice', async () => {
  const catalog = await buildElectiveCatalog();
  const group501 = catalog[PERIOD]?.['501'];
  assert.ok(Array.isArray(group501));

  const pe = group501.find((definition) => definition.selectionId === PE_SELECTION);
  assert.deepEqual(pe, {
    selectionId: PE_SELECTION,
    label: 'Поток физкультуры',
    alternatives: [
      { value: 'stream-1', label: '1 поток' },
      { value: 'stream-2', label: '2 поток' }
    ]
  });
});

test('explicit PE labels do not change existing medicine course 3 elective labels', async () => {
  const catalog = await buildElectiveCatalog();
  const group301 = catalog[PERIOD]?.['301'];
  assert.ok(Array.isArray(group301));

  const existing = group301.find((definition) => definition.selectionId === 'medicine-3-choice-discipline-2026-s1');
  assert.ok(existing);
  assert.equal(existing.label, 'Дисциплина по выбору');
  assert.ok(existing.alternatives.length > 1);
});
