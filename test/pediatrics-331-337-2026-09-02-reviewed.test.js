import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest,
} from '../src/explicit-decisions.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const minutes = (value) => {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};
const overlaps = (left, right) =>
  minutes(left.startTime) < minutes(right.endTime)
  && minutes(right.startTime) < minutes(left.endTime);

test('current pediatrics 331-337 source is freshly reviewed and remains fail-closed for platform publication', async () => {
  const [manifest, source, semantic, evidence, qa, diff] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-331-337-2026-09-02.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-331-337-2026-09-02.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337-2026-09-02.semantic-review.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337-2026-09-02.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337-2026-09-02.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337-2026-09-02.source-change-full-diff.json'),
  ]);

  assert.equal(source.source.sha256, '6ad088c6b39973a5c9d76a694a64bab4e34641f8d4b80123dc97bc3f3af0bba1');
  assert.equal(source.source.byteLength, 19647);
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(source.lifecycle.status, 'semantic-qa-pass-platform-review-required');
  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, false);
  assert.equal(semantic.semanticPublicationGate, 'PASS');
  assert.equal(semantic.platformPublicationGate, 'REVIEW_REQUIRED');
  assert.deepEqual(semantic.unresolvedAmbiguities, []);
  assert.equal(evidence.platformCompatibility.status, 'review-required');
  assert.equal(manifest.sourceSha256, source.source.sha256);
  assert.equal(evidence.sourceSha256, source.source.sha256);

  assert.deepEqual(diff.normalizedSemanticDiff, {
    changedCells: ['G24'],
    addedCells: [],
    removedCells: [],
  });
  assert.deepEqual(diff.mergedRangeDiff, { added: [], removed: [] });
  assert.equal(diff.semanticDecisionReuseAllowed, false);

  const g24Tuple = manifest.decisions.filter((tuple) => tuple[0] === 'G24#s1');
  assert.deepEqual(g24Tuple, [
    ['G24#s1','20','104104104104104104','13:00','14:30',1,1,0],
  ]);

  const context = {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId,
  };
  const events = expandExplicitDecisionManifest(manifest, context);
  assert.equal(events.length, 1781);
  assert.equal(
    digestNormalizedEvents(events),
    'sha256:5257c73ffc8c0affce67f84079a1358f8565e8c18d51cebeee94ef301eb19663',
  );
  assert.deepEqual(
    Object.fromEntries(source.expectedGroupIds.map((groupId) => [
      groupId,
      events.filter((event) => event.groupId === groupId).length,
    ])),
    {
      '331':254,'332':254,'333':253,'334':254,
      '335':255,'336':255,'337':256,
    },
  );

  const g24 = events.filter((event) => event.sourceRef.locator === '3пед.!G24#s1');
  assert.equal(g24.length, 12);
  assert.ok(g24.every((event) =>
    event.groupId === '336'
    && event.discipline === 'Иммунология'
    && event.startTime === '13:00'
    && event.endTime === '14:30'
  ));
  assert.deepEqual(g24.map((event) => event.date), [
    '2026-09-03','2026-09-10','2026-09-17','2026-09-24',
    '2026-10-01','2026-10-08','2026-10-15','2026-10-22',
    '2026-10-29','2026-11-05','2026-11-12','2026-11-19',
  ]);

  const microbiologyMonday = events.filter((event) =>
    event.groupId === '333'
    && event.date === '2026-12-07'
    && event.sourceRef.locator === '3пед.!D12#s2'
    && event.discipline === 'Микробиология, вирусология'
  );
  assert.equal(microbiologyMonday.length, 1);
  assert.equal(microbiologyMonday[0].startTime, '15:40');
  assert.equal(microbiologyMonday[0].endTime, '18:05');
  assert.equal(
    events.filter((event) =>
      event.groupId === '333'
      && event.discipline === 'Микробиология, вирусология'
      && new Date(`${event.date}T12:00:00Z`).getUTCDay() === 1
    ).length,
    1,
  );
  assert.equal(evidence.d20SyntheticMondayCount, 0);
  assert.deepEqual(evidence.operatorConfirmationIds, ['USER-2026-09-02-PED3-KEEP-07-12']);

  const ambiguousClinical = events.filter((event) =>
    event.lessonType === 'practice' && [
      'Общая хирургия',
      'Пропедевтика внутренних болезней',
      'Пропедевтика детских болезней',
      'Учебная практика. Практика по получению первичных профессиональных умений и навыков диагностического профиля',
    ].includes(event.discipline)
  );
  assert.ok(ambiguousClinical.length > 0);
  assert.ok(ambiguousClinical.every((event) => event.location === null));
  assert.equal(evidence.locationPolicy.suspiciousSourceLiteralCorrected, false);

  const signatures = new Set();
  for (const event of events) {
    const signature = [
      event.groupId,event.date,event.startTime,event.endTime,
      event.discipline,event.lessonType,event.location ?? '',
    ].join('|');
    assert.equal(signatures.has(signature), false);
    signatures.add(signature);
  }

  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  const pairs = [];
  for (const list of byDay.values()) {
    for (let left=0; left<list.length; left += 1) {
      for (let right=left+1; right<list.length; right += 1) {
        if (overlaps(list[left], list[right])) pairs.push([list[left],list[right]]);
      }
    }
  }
  assert.equal(pairs.length, 4);
  assert.equal(qa.checksDetail.overlaps.count, 4);
  assert.equal(evidence.explicitOverlapWarningCount, 4);
  assert.deepEqual(
    pairs.map(([left,right]) => [left.groupId,left.date,left.sourceRef.locator,right.sourceRef.locator]),
    [
      ['333','2026-12-24','3пед.!D23#s1#t2','3пед.!D25#s1'],
      ['334','2026-12-03','3пед.!E23#s1','3пед.!E23#s2'],
      ['334','2026-12-24','3пед.!E23#s3#t2','3пед.!E25#s1'],
      ['337','2026-11-25','3пед.!H20#s2','3пед.!H21#s1'],
    ],
  );
});