import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const qa = new URL('../qa/2026-2027-semester-1/', import.meta.url);
const sourceSha = '55f6431357309340f3a075d807814fa5ff3dd982d16230792ee24ec5f0e5cdff';
const expected = [
  ['592','2026-09-04','C16','CI28'],
  ['594','2026-10-30','BA18','CI28'],
  ['594','2026-11-06','BA18','CI28'],
];

test('C24(5) keeps exactly 3 owner-acknowledged overlaps as source-backed QA warnings', async () => {
  const load = async name => JSON.parse(await readFile(new URL(name, qa), 'utf8'));
  const [decision, audit, manifest, review] = await Promise.all([
    load('dentistry-591-594.overlap-resolution.json'),
    load('dentistry-591-594.grid-audit.json'),
    load('dentistry-591-594.candidate-manifest.json'),
    load('dentistry-591-594.current-source-review.json'),
  ]);
  for (const data of [decision, audit, manifest, review]) assert.equal(data.sourceSha256 ?? data.source?.sha256, sourceSha);
  assert.equal(decision.decision, 'KEEP_BOTH_EXPLICIT_EVENTS_AND_RECORD_QA_WARNING');
  assert.equal(decision.conflictClassification, 'SOURCE_BACKED_ACKNOWLEDGED_OVERLAP');
  assert.equal(decision.severity, 'WARNING');
  assert.deepEqual(decision.canonicalRules, ['G16','C13','C24(5)']);
  assert.equal(decision.whitelistStrict, true);
  assert.equal(decision.automaticTimeAdjustmentAllowed, false);
  assert.equal(decision.deleteOneEventAllowed, false);
  assert.equal(decision.makeOneEventOptional, false);
  assert.equal(decision.publicationAllowed, false);
  assert.deepEqual(decision.approvedPairs.map(({groupId,date,first}) =>
    [groupId,date,first.sourceGridCell,first.sourceReferenceTimeCell]), expected);
  assert.deepEqual(audit.sourceBackedOverlaps.map(({group,date,first}) => [group,date,first.sourceCell]),
    expected.map(([group,date,cell]) => [group,date,cell]));
  assert.equal(manifest.acknowledgedSourceOverlaps.count, 3);
  assert.equal(review.acknowledgedSourceOverlaps.count, 3);
  assert.equal(manifest.publicationAllowed, false);
  assert.equal(review.publicationAllowed, false);
  for (const [index,pair] of decision.approvedPairs.entries()) {
    const overlap = audit.sourceBackedOverlaps[index];
    assert.equal(pair.groupId,overlap.group);
    assert.equal(pair.date,overlap.date);
    assert.equal(pair.first.discipline,overlap.first.discipline);
    assert.equal(pair.first.startTime+'-'+pair.first.endTime,overlap.first.time);
    assert.equal(pair.first.sourceGridCell,overlap.first.sourceCell);
    assert.equal(pair.second.discipline,overlap.second.discipline);
    assert.equal(pair.second.startTime+'-'+pair.second.endTime,overlap.second.time);
    assert.equal(pair.second.sourceGridCell,overlap.second.sourceCell);
    assert.equal(pair.first.eventKind,'MANDATORY');
    assert.equal(pair.second.eventKind,'MANDATORY');
  }
});
