import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { validatePackage } from '../tools/validate_reviewed_intake.mjs';
const dir=new URL('../qa/2026-2027-semester-1/intake-2026-11-26/',import.meta.url);
const read=(p)=>JSON.parse(readFileSync(new URL(p,dir),'utf8'));
test('three local dentistry replay attestations match immutable packages, release remains blocked',()=>{
  const r=read('registry.json'), report=read('replay-2026-11-28/dentistry-special-report.json');
  assert.equal(report.schema,'kgmu-local-dentistry-replay-v1');
  assert.equal(report.engineBaseCommit,r.engineBaseCommit);
  assert.equal(report.platformBaseCommit,r.platformBaseCommit);
  assert.equal(report.publicationAllowed,false);
  assert.equal(report.releaseGate,'REVIEW_REQUIRED');
  assert.equal(report.sourceCount,3);
  assert.deepEqual(report.sources.map(s=>s.profile),['dentistry-291-294','dentistry-391-394','dentistry-491-494']);
  assert.deepEqual(report.sources.map(s=>s.eventCount),[1066,528,564]);
  assert.equal(report.sources.reduce((n,s)=>n+s.eventCount,0),2158);
  assert.equal(report.eventCount,2158);
  for(const s of report.sources) {
    const e=r.sources.find(e=>e.package?.startsWith('packages/'+s.profile+'-'));
    assert(e);
    for (const k of ['sourceSha256','byteLength','originalEvidenceSha256','packageSha256','eventCount','eventSetDigest','groupCounts','publicationAllowed']) assert.deepEqual(s[k],e[k]);
    assert.equal(s.semanticDifferences,0);
    assert.equal(s.publicationAllowed,false);
    assert.equal(validatePackage(JSON.parse(gunzipSync(readFileSync(new URL(e.package,dir)))),e),s.eventCount);
  }
  assert.match(report.sources[2].sourceVerification,/old XLSX unavailable/);
});
