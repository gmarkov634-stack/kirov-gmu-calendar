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

test('current medicine 301-310 source is freshly reviewed without cross-SHA semantic reuse', async () => {
  const [manifest, source, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-301-310-2026-09-02.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-301-310-2026-09-02.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-301-310-2026-09-02.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/medicine-301-310-2026-09-02.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-301-310-2026-09-02.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-301-310-2026-09-02.source-change-full-diff.json'),
  ]);

  assert.equal(diff.semanticDecisionReuseAllowed, false);
  assert.equal(source.source.sha256, '367de1a0311d94477691c3c7729460e0455e3b7cb67e5cb8bb38148f531e37c1');
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(semantic.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);
  assert.equal(source.parserRulesVersion, 'kgmu-2026-10-01-v5');
  assert.equal(manifest.parserRulesVersion, source.parserRulesVersion);
  assert.equal(semantic.parserRulesVersion, source.parserRulesVersion);
  assert.equal(evidence.parserRulesVersion, source.parserRulesVersion);
  assert.equal(qa.decision, 'pass');
  assert.equal(semantic.stream.unresolvedAmbiguities, 0);
  assert.deepEqual(diff.cellDiff.changed.map((item) => item.coord).sort(), ['B27', 'B31', 'J16']);
  assert.equal(diff.mergedRangeDiff.added.length, 0);
  assert.equal(diff.mergedRangeDiff.removed.length, 0);

  const j16 = manifest.decisions.filter((tuple) => tuple[0] === 'J16#s1');
  assert.deepEqual(j16, [['J16#s1','100','41041041041041041041041041','10:40','13:05',9,1,6]]);

  assert.equal(
    manifest.disciplineTable[15],
    'Статистические методы в доказательной медицине с использованием информационных технологий',
  );
  assert.equal(manifest.decisions.some((tuple) => tuple[0] === 'B31#s6'), false);
  assert.equal(manifest.decisions.some((tuple) => tuple[0] === 'B31#s10'), false);
  assert.equal(manifest.decisionCount, 174);

  for (const selection of Object.values(manifest.selectionMetadataByDisciplineIndex)) {
    assert.equal(selection.selectionGroupLabel, 'Дисциплина по выбору');
    assert.ok(selection.selectionOptionLabel);
  }

  const plan = buildExplicitPublicationPlan({ manifest, source, evidence, qa });
  assert.equal(plan.events.length, 3531);
  assert.equal(plan.candidateDigest, 'sha256:87bd585f77cea68307967e21bdc52bb660717d9e84642523d5869c25b1857dfb');
  assert.deepEqual(Object.fromEntries(plan.versions.map((version) => [version.groupId, version.eventCount])), {
    '301': 352, '302': 352, '303': 356, '304': 356, '305': 356,
    '306': 356, '307': 356, '308': 355, '309': 353, '310': 339,
  });

  const b27 = plan.events.filter((event) => event.sourceRef.locator === '3 леч.1!B27#s1');
  assert.equal(b27.length, 120);
  assert.ok(b27.every((event) =>
    event.discipline === 'Статистические методы в доказательной медицине с использованием информационных технологий' &&
    event.selection?.selectionGroupId === 'medicine-3-choice-discipline-2026-s1' &&
    event.selection?.selectionOptionId === 'statistical-evidence-medicine'
  ));

  const currentJ16 = plan.events.filter((event) => event.sourceRef.locator === '3 леч.1!J16#s1');
  assert.equal(currentJ16.length, 18);
  assert.ok(currentJ16.every((event) => event.startTime === '10:40' && event.endTime === '13:05'));

  assert.equal(
    plan.events.some((event) =>
      event.sourceRef.locator === '3 леч.1!B31#s6' ||
      event.sourceRef.locator === '3 леч.1!B31#s10'
    ),
    false,
  );

  const operator = plan.events.filter((event) =>
    event.groupId === '310' &&
    event.date === '2026-12-30' &&
    event.startTime === '08:00' &&
    event.endTime === '10:25' &&
    event.discipline === 'Молекулярные механизмы в патологии человека'
  );
  assert.equal(operator.length, 1);
  assert.equal(operator[0].sourceRef.locator, '3 леч.1!B18#operator-g310');
  assert.deepEqual(operator[0].selection, {
    selectionGroupId: 'medicine-3-choice-discipline-2026-s1',
    selectionOptionId: 'molecular-pathology',
  });

  assert.equal(
    plan.events.some((event) =>
      event.groupId === '308' &&
      event.date === '2026-12-23' &&
      event.sourceRef.locator === '3 леч.1!B18#s2'
    ),
    false,
  );

  const choiceEvents = plan.events.filter((event) => event.selection);
  assert.equal(choiceEvents.length, 1208);
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

  assert.equal(alternatives, 1967);
  assert.equal(nonAlternative.length, 1);
  assert.equal(nonAlternative[0][0].groupId, '308');
  assert.equal(nonAlternative[0][0].date, '2026-12-23');
  assert.deepEqual(
    new Set(nonAlternative[0].map((event) => event.sourceRef.locator)),
    new Set(['3 леч.1!I21#s1', '3 леч.1!I10#s2']),
  );
});