import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const dir=new URL('../qa/2026-2027-semester-1/intake-2026-11-26/',import.meta.url);
const read=(p)=>JSON.parse(readFileSync(new URL(p,dir),'utf8'));
test('private PostgreSQL audit covers every reviewed candidate and keeps continuity gate closed',()=>{
  const registry=read('registry.json');
  const r=read('replay-2026-11-28/postgres-compatibility-report.json');
  assert.equal(r.schema,'kgmu-local-postgres-compatibility-v1');
  assert.equal(r.engineBaseCommit,registry.engineBaseCommit);
  assert.equal(r.platformBaseCommit,registry.platformBaseCommit);
  assert.equal(r.migration,'0006');assert.match(r.postgresVersion,/^16\./);
  assert.equal(r.privateUnixSocketOnly,true);
  assert.equal(r.sourceCount,12);assert.equal(r.eventCount,22876);
  assert.equal(r.publicationAllowed,false);assert.equal(r.releaseGate,'REVIEW_REQUIRED');
  assert.equal(r.sources.length,12);assert.equal(new Set(r.sources.map(s=>s.sourceSha256)).size,12);
  for(const s of r.sources) {
    const e=registry.sources.find(e=>e.sourceSha256===s.sourceSha256);
    assert(e?.package?.startsWith('packages/'+s.profile+'-'));
    for(const k of ['sourceSha256','eventCount','eventSetDigest','packageSha256','publicationAllowed'])assert.deepEqual(s[k],e[k]);
    assert.equal(s.result,'PASS');assert.equal(s.rollbackVerified,true);
    assert.match(s.testSha256,/^[0-9a-f]{64}$/);
    assert.equal(s.platformScope,s.profile==='dentistry-591-594'?'ISOLATED_PR61_SNAPSHOT':'MAIN_PIN');
  }
  assert.equal(r.sources.reduce((n,s)=>n+s.eventCount,0),22876);
  const c=r.sheetContinuity;
  const entry=registry.sources.find(e=>e.sourceSha256===c.sourceSha256);
  assert.equal(entry.eventCount,4293);assert.equal(c.originalEventSetDigest,entry.eventSetDigest);
  assert.equal(c.correctedEventSetDigest,'sha256:97fd0f8812e4d256693e5e6034933313e73176272064d55a5a8edf94a9b5ebe4');
  assert.equal(c.originalSheet,'1 леч. 2');assert.equal(c.correctedSheet,'1 леч. 2  ');
  assert.equal(c.originalKeys,4293);assert.equal(c.correctedKeys,4293);assert.equal(c.unchangedKeys,0);assert.equal(c.changedKeys,4293);
  assert.equal(c.exactSheetPersistence,'PASS');assert.equal(c.semanticDifferences,0);
  assert.equal(c.continuityGate,'BLOCKED');assert.equal(c.rollbackVerified,true);assert.equal(c.publicationAllowed,false);
});
