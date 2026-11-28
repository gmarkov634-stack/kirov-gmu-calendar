import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildReviewBundle, SourceNotInReviewIntake } from '../tools/build_reviewed_intake_runtime_bundle.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const script=resolve(root,'tools/build_reviewed_intake_runtime_bundle.mjs');
const dir=resolve(root,'qa/2026-2027-semester-1/intake-2026-11-26');

test('runtime review requires exact source bytes; unknown SHA cannot produce candidate',()=>{
  assert.throws(()=>buildReviewBundle(Buffer.from('unknown source bytes')),SourceNotInReviewIntake);
  assert.throws(()=>buildReviewBundle(Buffer.alloc(0)));
  const temp=mkdtempSync(resolve(tmpdir(),'kgmu-runtime-review-'));
  try {
    const input=resolve(temp,'unknown.xlsx'),output=resolve(temp,'output.json');
    writeFileSync(input,'unknown source bytes');
    const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
    assert.equal(run(root,input,output).status,20);
    assert(!existsSync(output));
    const registry=JSON.parse(readFileSync(resolve(dir,'registry.json'),'utf8'));
    const known=registry.sources.find(e=>e.package);
    assert.equal(run(root,'-',output,'--trusted-source-sha='+known.sourceSha256).status,1);
    assert(!existsSync(output));
    assert.equal(run(temp,input,output).status,1);
    assert(!existsSync(output));
  }finally{rmSync(temp,{recursive:true,force:true});}
});

test('all 12 exact archived XLSX produce closed review projections',{skip:!process.env.KGMU_REVIEW_OBJECTS},()=>{
  const registry=JSON.parse(readFileSync(resolve(dir,'registry.json'),'utf8'));
  const sources=registry.sources.filter(e=>e.package);
  assert.equal(sources.length,12);
  let total=0;
  for(const entry of sources){
    const bytes=readFileSync(resolve(process.env.KGMU_REVIEW_OBJECTS,entry.sourceSha256+'.xlsx'));
    const b=buildReviewBundle(bytes);
    assert.equal(b.reviewOnly,true);
    assert.equal(b.reviewedSource.sha256,entry.sourceSha256);
    assert.equal(b.reviewedSource.packageSha256,entry.packageSha256);
    assert.equal(b.reviewedSource.originalEventSetDigest,entry.eventSetDigest);
    assert.equal(b.reviewedSource.releaseGate,'REVIEW_REQUIRED');
    assert.equal(b.qaReport.publicationAllowed,false);
    assert.equal(b.source.lifecycle.publicationAllowed,false);
    assert.equal(b.parsingResult.events.length,entry.eventCount);
    total+=entry.eventCount;
    const changed=Buffer.from(bytes);
    changed[changed.length-1]^=1;
    assert.throws(()=>buildReviewBundle(changed),SourceNotInReviewIntake);
  }
  assert.equal(total,22876);
});
