import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplay, correctExactSheet } from '../tools/replay_reviewed_intake.mjs';

const replay=buildReplay();
test('reviewed explicit decisions replay exactly with existing canonical engine',()=>{
  assert.equal(replay.sourceCount,20);
  assert.equal(replay.reviewedCount,12);
  assert.equal(replay.regenerated,7);
  assert.equal(replay.regeneratedEvents,18458);
  assert.equal(replay.sources.filter(x=>x.replay==='PROVENANCE_AUDIT_ONLY').length,5);
  assert.equal(replay.sources.filter(x=>x.replay==='EXPLICIT_MANIFEST_EXACT').length,6);
  assert.equal(replay.publicationAllowed,false);
  assert.equal(replay.releaseGate,'REVIEW_REQUIRED');
});
test('111–120 exact workbook sheet correction is provenance only and remains blocked',()=>{
  const corrections=replay.sources.filter(x=>x.correction);
  assert.equal(corrections.length,1);
  const [row]=corrections;
  assert.equal(row.eventCount,4293);
  assert.equal(row.correction.priorSheet,'1 леч. 2');
  assert.equal(row.correction.exactSheet,'1 леч. 2  ');
  assert.equal(row.correction.semanticChanges,0);
  assert.equal(row.correction.publicationAllowed,false);
  assert.notEqual(row.originalEventSetDigest,row.replayedEventSetDigest);
  assert(row.locators.every(l=>l.startsWith('1 леч. 2  !')));
});
test('source-specific sheet correction refuses different source identity',()=>{
  assert.throws(()=>correctExactSheet({}, {sourceSha256:'a'.repeat(64)}));
});
