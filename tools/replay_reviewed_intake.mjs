import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandExplicitDecisionManifest, digestNormalizedEvents } from '../src/explicit-decisions.js';
import { expandMedicineFacultativeFixture } from '../src/medicine-publication-plan.js';
import { validateRegistry } from './validate_reviewed_intake.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'qa/2026-2027-semester-1/intake-2026-11-26');
const parse = (buf) => JSON.parse(buf.toString('utf8'));
const fixedSha = '11056e3eddc9c9d82d1c094cc77f8562bdcced883e60f9c7bb20274b0eb86954';
const priorSheet = '1 леч. 2';
const exactSheet = '1 леч. 2  ';
const compare = (a,b) => Number(a.groupId)-Number(b.groupId)||a.date.localeCompare(b.date)||(a.startTime??'').localeCompare(b.startTime??'')||(a.endTime??'').localeCompare(b.endTime??'')||a.discipline.localeCompare(b.discipline)||a.lessonType.localeCompare(b.lessonType)||a.sourceRef.locator.localeCompare(b.sourceRef.locator);

function expand(bundle) {
  const ctx = {universityId:bundle.source.universityId,academicPeriodId:bundle.source.academicPeriodId,sourceId:bundle.source.source.sourceId};
  const events=expandExplicitDecisionManifest(bundle.manifest,ctx);
  if(bundle.facultatives) events.push(...expandMedicineFacultativeFixture(bundle.facultatives,ctx));
  return events.sort(compare);
}

export function correctExactSheet(bundle, entry) {
  // Exact source-specific provenance correction, never a general alias/trim rule.
  assert.equal(entry.sourceSha256,fixedSha);
  assert.equal(bundle.source.source.sha256,fixedSha);
  assert.equal(bundle.manifest.sourceSha256,fixedSha);
  assert.equal(bundle.facultatives.sourceSha256,fixedSha);
  assert.deepEqual(bundle.source.workbookExpectations.sheetNames,[exactSheet]);
  assert.equal(bundle.manifest.sheetName,priorSheet);
  assert.equal(bundle.facultatives.sheetName,priorSheet);
  const corrected=structuredClone(bundle);
  corrected.manifest.sheetName=exactSheet;
  corrected.facultatives.sheetName=exactSheet;
  return corrected;
}

export function buildReplay() {
  validateRegistry();
  const reg=parse(readFileSync(resolve(directory,'registry.json')));
  const sources=[];let regenerated=0,regeneratedEvents=0;
  for(const entry of reg.sources) {
    const meta={sourceSha256:entry.sourceSha256,byteLength:entry.byteLength,program:entry.program,status:entry.status};
    if(!entry.package) { sources.push({...meta,fixture:entry.fixture});continue; }
    const pkg=parse(gunzipSync(readFileSync(resolve(directory,entry.package)),{maxOutputLength:16*1024*1024}));
    const bundle= parse(Buffer.from(pkg.artifacts.find(f=>f.path===pkg.originalCandidatePath).content,'utf8'));
    const original=bundle.events??bundle.parsingResult.events;
    let events=original,replay='PROVENANCE_AUDIT_ONLY',correction=null;
    if(['kgmu-explicit-semantic-decisions-v3','kgmu-explicit-semantic-decisions-v4'].includes(bundle.manifest?.schema)) {
      events=expand(bundle);
      assert.deepEqual(events,original,'explicit manifest replay differs for '+entry.sourceSha256);
      assert.equal(digestNormalizedEvents(events),entry.eventSetDigest);
      regenerated++;regeneratedEvents+=events.length;
      replay='EXPLICIT_MANIFEST_EXACT';
      if(entry.sourceSha256===fixedSha) {
        const corrected=correctExactSheet(bundle,entry);
        const fixed=expand(corrected);
        const withoutIdentity=(e)=>{const {eventId,sourceRef,...rest}=e;const [sheet,loc]=sourceRef.locator.split('!');return {...rest,sourceRef:{sourceId:sourceRef.sourceId,locator:loc}}};
        assert.deepEqual(fixed.map(withoutIdentity),events.map(withoutIdentity),'semantic data changed by correction');
        assert(fixed.every(e=>e.sourceRef.locator.startsWith(exactSheet+'!')));
        assert.equal(new Set(fixed.map(e=>e.eventId)).size,fixed.length);
        assert(fixed.every((e,i)=>e.eventId!==events[i].eventId),'provenance-derived event IDs must be regenerated');
        correction={scope:'EXACT_SOURCE_SHEET_NAME',priorSheet,exactSheet,priorEventSetDigest:entry.eventSetDigest,correctedEventSetDigest:digestNormalizedEvents(fixed),eventCount:fixed.length,semanticChanges:0,publicationAllowed:false,releaseGate:'REVIEW_REQUIRED'};
        events=fixed;replay='EXPLICIT_MANIFEST_EXACT_WITH_PROVENANCE_CORRECTION';
      }
    }
    sources.push({...meta,eventCount:events.length,originalEventSetDigest:entry.eventSetDigest,replayedEventSetDigest:digestNormalizedEvents(events),replay,correction,locators:[...new Set(events.map(e=>e.sourceRef.locator.split('#')[0]))].sort()});
  }
  assert.equal(regenerated,7);assert.equal(regeneratedEvents,18458);
  return {schema:'kgmu-reviewed-intake-archive-replay-v1',sourceCount:20,reviewedCount:12,regenerated,regeneratedEvents,publicationAllowed:false,releaseGate:'REVIEW_REQUIRED',sources};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildReplay()));
