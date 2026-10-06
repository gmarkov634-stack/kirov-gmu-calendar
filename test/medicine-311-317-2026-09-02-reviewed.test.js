import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildExplicitPublicationPlan } from '../src/explicit-publication-plan.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime) &&
  minutes(right.startTime) < minutes(left.endTime);

test('current medicine 311-317 corrected v6 review is source-faithful and fail-closed pending platform gate', async () => {
  const [manifest, source, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-311-317-2026-09-02.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-311-317-2026-09-02.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-311-317-2026-09-02.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-311-317-2026-09-02.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-311-317-2026-09-02.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-311-317-2026-09-02.source-change-full-diff.json'),
  ]);

  assert.equal(diff.semanticDecisionReuseAllowed, false);
  assert.equal(source.source.sha256, '007980762e5b3648546851f5357bca12fc867e17752862602f6e2518febd1eee');
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(semantic.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(source.parserRulesVersion, 'kgmu-2026-10-06-v6');
  assert.equal(manifest.parserRulesVersion, source.parserRulesVersion);
  assert.equal(semantic.parserRulesVersion, source.parserRulesVersion);
  assert.equal(evidence.parserRulesVersion, source.parserRulesVersion);
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, false);
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(source.lifecycle.status, 'semantic-qa-pass-platform-review-required');
  assert.equal(semantic.platformPublicationGate, 'REVIEW_REQUIRED');
  assert.equal(evidence.platformCompatibility.status, 'review-required');
  assert.equal(qa.compatibilityGate.status, 'review-required');
  assert.deepEqual(diff.cellDiff.changed.map((item) => item.coord), ['B29']);
  assert.equal(diff.mergedRangeDiff.added.length, 0);
  assert.equal(diff.mergedRangeDiff.removed.length, 0);

  assert.equal(
    manifest.disciplineTable[18],
    'Статистические методы в доказательной медицине с использованием информационных технологий',
  );
  assert.deepEqual(
    manifest.decisions.filter((tuple) => tuple[0] === 'B29#s8'),
    [['B29#s8','7f','8208208208208208000000000','13:00','15:25',18,1,10]],
  );
  assert.deepEqual(
    manifest.decisions.filter((tuple) => tuple[0] === 'B29#s9'),
    [['B29#s9','7f','200000000','14:40','17:05',18,1,10]],
  );
  assert.equal(manifest.decisionCount, 126);

  for (const selection of Object.values(manifest.selectionMetadataByDisciplineIndex)) {
    assert.equal(selection.selectionGroupLabel, 'Дисциплина по выбору');
    assert.ok(selection.selectionOptionLabel);
  }

  const plan = buildExplicitPublicationPlan({ manifest, source, evidence, qa });
  assert.equal(plan.events.length, 2522);
  assert.equal(plan.candidateDigest, 'sha256:7b8eed2d995ec3aa1fa49c02b4ddf050f05b5b3c87e6ae1ebf93142110139c91');
  assert.deepEqual(Object.fromEntries(plan.versions.map((version) => [version.groupId, version.eventCount])), {
    '311': 361, '312': 361, '313': 359, '314': 360,
    '315': 360, '316': 360, '317': 361,
  });

  const b29Statistics = plan.events.filter((event) =>
    event.sourceRef.locator === '3 леч.2!B29#s8' ||
    event.sourceRef.locator === '3 леч.2!B29#s9'
  );
  assert.equal(b29Statistics.length, 84);
  assert.deepEqual([...new Set(b29Statistics.map((event) => event.date))].sort(), [
    '2026-10-09','2026-10-16','2026-10-23','2026-10-30',
    '2026-11-06','2026-11-13','2026-11-20','2026-11-27',
    '2026-12-04','2026-12-11','2026-12-18','2026-12-25',
  ]);
  assert.ok(b29Statistics.every((event) =>
    event.discipline === 'Статистические методы в доказательной медицине с использованием информационных технологий' &&
    event.selection?.selectionGroupId === 'medicine-3-choice-discipline-2026-s1' &&
    event.selection?.selectionOptionId === 'statistical-evidence-medicine'
  ));
  assert.ok(b29Statistics.every((event) =>
    event.location === null &&
    event.assessment?.type === 'credit' &&
    event.assessment?.label === 'зачет' &&
    event.assessment?.sourceRef?.locator === '3 леч.2!E38'
  ));
  assert.equal(
    b29Statistics.filter((event) => event.date === '2026-10-09').length,
    7,
  );
  assert.ok(
    b29Statistics.filter((event) => event.date === '2026-10-09')
      .every((event) => event.startTime === '14:40' && event.endTime === '17:05'),
  );
  assert.ok(
    b29Statistics.filter((event) => event.date !== '2026-10-09')
      .every((event) => event.startTime === '13:00' && event.endTime === '15:25'),
  );

  for (const suppressed of evidence.r66SuppressedComputedOccurrences) {
    const fullLocator = `3 леч.2!${suppressed.locator}`;
    assert.equal(plan.events.some((event) =>
      event.groupId === suppressed.groupId &&
      event.date === suppressed.date &&
      event.sourceRef.locator === fullLocator
    ), false);
  }

  for (const expected of evidence.onlineEvents) {
    const matches = plan.events.filter((event) =>
      event.date === expected.date &&
      event.discipline === expected.discipline &&
      event.sourceRef.locator === expected.sourceLocator
    );
    assert.equal(matches.length, 7);
    assert.ok(matches.every((event) => event.location === 'Онлайн'));
  }

  const choiceEvents = plan.events.filter((event) => event.selection);
  assert.equal(choiceEvents.length, 903);
  assert.deepEqual(
    [...new Set(choiceEvents.map((event) => event.selection.selectionOptionId))].sort(),
    [
      'biochemical-healthy-lifestyle',
      'dietology',
      'functional-diagnostics',
      'intercultural-professional-communication',
      'latin-pharmaceutical-terminology',
      'molecular-pathology',
      'statistical-evidence-medicine',
    ],
  );

  const signatures = new Set();
  for (const event of plan.events) {
    const signature = [
      event.groupId,event.date,event.startTime,event.endTime,
      event.discipline,event.lessonType,event.location ?? '',
      event.selection?.selectionGroupId ?? '',event.selection?.selectionOptionId ?? '',
    ].join('|');
    assert.equal(signatures.has(signature), false);
    signatures.add(signature);
  }

  const byDay = new Map();
  for (const event of plan.events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }

  let alternatives = 0;
  const nonAlternative = [];
  for (const events of byDay.values()) {
    for (let left = 0; left < events.length; left += 1) {
      for (let right = left + 1; right < events.length; right += 1) {
        const a = events[left];
        const b = events[right];
        if (!overlaps(a, b)) continue;
        const sameSelectionGroup =
          a.selection?.selectionGroupId &&
          a.selection.selectionGroupId === b.selection?.selectionGroupId;
        if (sameSelectionGroup && a.selection.selectionOptionId !== b.selection.selectionOptionId) {
          alternatives += 1;
        } else {
          nonAlternative.push([a, b]);
        }
      }
    }
  }
  assert.equal(alternatives, 1491);
  assert.equal(nonAlternative.length, 0);
});