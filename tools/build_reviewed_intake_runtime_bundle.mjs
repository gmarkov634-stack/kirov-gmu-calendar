#!/usr/bin/env node
// Exact, review-only runtime projection of the frozen 26 November 2026 intake.
// This is NOT a new parser, publication plan or approval. No network access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { expandExplicitDecisionManifest, digestNormalizedEvents } from '../src/explicit-decisions.js';
import { expandMedicineFacultativeFixture } from '../src/medicine-publication-plan.js';
import { validateRegistry, validatePackage } from './validate_reviewed_intake.mjs';
import { correctExactSheet } from './replay_reviewed_intake.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'qa/2026-2027-semester-1/intake-2026-11-26');
const registrySha = '9dfc7c2fb3daf04d01a84ead5319355cd3d4f0854d4c1a25c6cb49e55e4ad385';
const med111 = '11056e3eddc9c9d82d1c094cc77f8562bdcced883e60f9c7bb20274b0eb86954';
const den191 = 'a0ea58290bd5e3a3de909b48e3ea9f1c69217b7134185d2606b56cd78e1029e5';
const den291 = 'f3cd3e91d7ee4fdb5409d263aa0c853331e3575760ca804869acae33fa47610b';
const den591 = '55f6431357309340f3a075d807814fa5ff3dd982d16230792ee24ec5f0e5cdff';
const correctedDigest = 'sha256:97fd0f8812e4d256693e5e6034933313e73176272064d55a5a8edf94a9b5ebe4';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a,b) => Number(a.groupId)-Number(b.groupId)||a.date.localeCompare(b.date)||(a.startTime??'').localeCompare(b.startTime??'')||(a.endTime??'').localeCompare(b.endTime??'')||a.discipline.localeCompare(b.discipline)||a.lessonType.localeCompare(b.lessonType)||a.sourceRef.locator.localeCompare(b.sourceRef.locator);
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const same = (a,b,msg) => assert.deepEqual(a,b,msg);

export class SourceNotInReviewIntake extends Error {}

function expand(bundle) {
  const ctx = {universityId:bundle.source.universityId, academicPeriodId:bundle.source.academicPeriodId, sourceId:bundle.source.source.sourceId};
  const base = expandExplicitDecisionManifest(bundle.manifest,ctx);
  const extra = bundle.facultatives ? expandMedicineFacultativeFixture(bundle.facultatives,ctx) : [];
  return {base, events:[...base,...extra].sort(compare)};
}

function projectDraft(entry,pkg,get,draft) {
  const sha = entry.sourceSha256;
  if (sha === den191) {
    // Preserve object-form legacy decisions and separate candidate/array digests.
    const stem = pkg.originalSourcePath.replace(/\.source\.json$/,'');
    const qaStem = 'qa/2026-2027-semester-1/' + stem.split('/').at(-1);
    const source = get(pkg.originalSourcePath);
    return {source, manifest:get(stem+'.decisions.json'),
      semanticReview:get(qaStem+'.semantic-review.json'), qaReport:get(pkg.originalQaPath),
      evidence:get(qaStem+'.evidence.json'), facultatives:null,
      parsingResult:{jobId:get(pkg.originalQaPath).parsingJobId, universityId:source.universityId,
        academicPeriodId:source.academicPeriodId, parserRulesVersion:source.parserRulesVersion,
        events:draft.events,warnings:[]}};
  }
  if (sha === den291) {
    // Same exact source-backed envelope used by frozen local PG regression.
    const source = get(pkg.originalSourcePath);
    const prior = get('semantic-review-local.json');
    same(prior.sourceSha256,sha); same(prior.publicationAllowed,false);
    assert(Object.values(prior.checks).every(x=>x===true));
    const semanticReview = {...prior,parserProfile:'S',parserRulesVersion:source.parserRulesVersion,
      rules:['R07','R09','R17','R41','R67','R69','S01','S04','S07','S08','S09'],
      unresolvedAmbiguities:0,coverage:{logicalSourceCellCount:79}};
    return {source,manifest:{schema:'kgmu-normalized-draft-review-v1',sourceSha256:sha},
      semanticReview,qaReport:get(pkg.originalQaPath), evidence:get('final-evidence.json'),
      facultatives:null,
      parsingResult:{jobId:draft.parsingJobId,universityId:source.universityId,
        academicPeriodId:source.academicPeriodId,parserRulesVersion:source.parserRulesVersion,
        events:draft.events,warnings:[]}};
  }
  if (sha === den591) {
    const review = get(pkg.originalSourcePath);
    const manifest = get(pkg.originalQaPath);
    const qaPath = pkg.originalQaPath.replace('candidate-manifest.json','overlap-resolution.json');
    const gridPath = pkg.originalQaPath.replace('candidate-manifest.json','grid-audit.json');
    const decision = get(qaPath), grid = get(gridPath);
    same(review.source.sha256,sha);same(manifest.publicationAllowed,false);
    same(decision.sourceSha256,sha);
    same(decision.decision,'KEEP_BOTH_EXPLICIT_EVENTS_AND_RECORD_QA_WARNING');
    same(decision.approvedPairs.length,3);same(grid.sourceBackedOverlaps.length,3);
    same(decision.approvedPairs.map(p=>[p.groupId,p.date]),grid.sourceBackedOverlaps.map(p=>[p.group,p.date]));
    const source = {fixtureId:'dentistry-591-594-review-'+sha.slice(0,12),
      universityId:'kirov-gmu',programId:review.source.programId,course:review.source.course,
      academicYear:review.source.academicYear,academicPeriodId:'2026-2027-semester-1',
      parserProfile:'C',parserRulesVersion:draft.parserRulesVersion,
      expectedGroupIds:review.source.expectedGroupIds,source:{...review.source,sourceId:'dentistry'},
      workbookExpectations:review.workbook};
    const provenance = draft.eventProvenanceById;
    same(Object.keys(provenance).sort(),draft.events.map(e=>e.eventId).sort());
    const rules = [...new Set(Object.values(provenance).flatMap(p=>p.appliedRules))].sort();
    const checks = decision.approvedPairs.map(pair=>({status:'warning',code:'ACKNOWLEDGED_SOURCE_TIME_OVERLAP',
      message:`group ${pair.groupId} on ${pair.date}: ${pair.first.discipline} ${pair.first.startTime}-${pair.first.endTime} and ${pair.second.discipline} ${pair.second.startTime}-${pair.second.endTime}; C24(5) confirms both remain`,
      sourceSheet:manifest.sourceSheet,sourceCellOrRange:pair.first.sourceGridCell,
      details:{sourceSha256:sha,groupId:pair.groupId,date:pair.date,first:pair.first,second:pair.second,ownerDecision:decision.decision}}));
    return {source,manifest,semanticReview:{sourceSha256:sha,parserProfile:'C',
      parserRulesVersion:draft.parserRulesVersion,rules,unresolvedAmbiguities:[],
      coverage:{logicalSourceCellCount:33}},
      qaReport:{...manifest,decision:'pass',checks,publicationAllowed:false},facultatives:null,
      evidence:get(pkg.originalEvidencePath),eventProvenanceById:provenance,
      parsingResult:{jobId:'review-dentistry5-'+sha.slice(0,16),universityId:source.universityId,
        academicPeriodId:source.academicPeriodId,parserRulesVersion:source.parserRulesVersion,
        events:draft.events,warnings:[]}};
  }
  throw new Error('unrecognized frozen draft format');
}

export function buildReviewBundle(sourceBytes) {
  assert(Buffer.isBuffer(sourceBytes) && sourceBytes.length > 0);
  const sha = hash(sourceBytes);
  const registryBytes = readFileSync(resolve(dir,'registry.json'));
  same(hash(registryBytes),registrySha,'frozen registry identity changed');
  const reg = parse(registryBytes);
  const matches=reg.sources.filter(e=>e.sourceSha256===sha && e.package);
  if (matches.length!==1) throw new SourceNotInReviewIntake('source SHA has no exact reviewed intake package');
  const entry = matches[0];
  same(sourceBytes.length,entry.byteLength);
  validateRegistry({directory:dir,repository:root});
  const packed=readFileSync(resolve(dir,entry.package));
  same(hash(packed),entry.packageSha256);
  const raw=gunzipSync(packed,{maxOutputLength:16*1024*1024});
  same(hash(raw),entry.uncompressedSha256);
  const pkg=parse(raw);
  validatePackage(pkg,entry);
  const artifacts=new Map(pkg.artifacts.map(a=>[a.path,a.content]));
  const get=(name)=>{assert(artifacts.has(name),'missing '+name);return parse(Buffer.from(artifacts.get(name)));};
  const original=get(pkg.originalCandidatePath);
  let bundle=original.parsingResult ? original : projectDraft(entry,pkg,get,original);
  bundle.evidence ??= get(pkg.originalEvidencePath);
  bundle.facultatives ??= null;
  const originalEvents=bundle.parsingResult.events;
  let mode='FROZEN_NORMALIZED_DRAFT',digest=entry.eventSetDigest,candidateDigest=entry.candidateDigest;
  same(digestNormalizedEvents(originalEvents),digest);
  if (['kgmu-explicit-semantic-decisions-v3','kgmu-explicit-semantic-decisions-v4'].includes(bundle.manifest.schema) && Array.isArray(bundle.manifest.decisions) && bundle.manifest.decisions.every(Array.isArray)) {
    same(expand(bundle).events,originalEvents,'canonical expansion differs from reviewed events');
    mode='EXPLICIT_MANIFEST_EXACT';
    if (sha===med111) {
      bundle=correctExactSheet(bundle,entry);
      const {base,events}=expand(bundle);
      const semantic=e=>{const {eventId,sourceRef,...rest}=e;return {...rest,sourceRef:{sourceId:sourceRef.sourceId,locator:sourceRef.locator.split('!')[1]}};};
      same(events.map(semantic),originalEvents.map(semantic));
      assert(events.every(e=>e.sourceRef.locator.startsWith('1 леч. 2  !')));
      same(digestNormalizedEvents(events),correctedDigest);
      bundle.manifest.candidateDigest=digestNormalizedEvents(base);
      bundle.parsingResult.events=events;
      digest=candidateDigest=correctedDigest;
      mode='EXPLICIT_MANIFEST_EXACT_WITH_PROVENANCE_CORRECTION';
    }
  } else {
    const approvedDrafts = [den191,den291,den591,
      '82fcb873776634553f9dcc5bf3da581654d59f4ef10db5ad6a779aa6d53f950d',
      'da25494598eab8d62d4b444a2ec4ce1ea28300250df8892ec992513777d7efe5'];
    assert(approvedDrafts.includes(sha),'unexpected normalized-draft source');
  }
  const {source,semanticReview,qaReport,parsingResult}=bundle;
  same(source.source.sha256,sha);same(source.source.byteLength,entry.byteLength);
  same(source.programId,entry.program);same(source.source.url,entry.sourceUrl);
  same(source.academicPeriodId,reg.academicPeriod);
  same(source.expectedGroupIds.slice().sort(),Object.keys(entry.groupCounts).sort());
  same(semanticReview.sourceSha256,sha);
  same(source.parserRulesVersion,parsingResult.parserRulesVersion);
  same(qaReport.publicationAllowed,false);
  same(qaReport.decision,'pass');
  same(parsingResult.events.length,entry.eventCount);
  same(digestNormalizedEvents(parsingResult.events),digest);
  // Runtime projection is always review-only, even if historic source metadata
  // describes a semantic PASS. Original package and registry stay immutable.
  source.lifecycle={...source.lifecycle,publicationAllowed:false};
  semanticReview.publicationAllowed=false;
  qaReport.candidateDigest=candidateDigest;
  qaReport.publicationAllowed=false;
  bundle.reviewedSource={repository:'gmarkov634-stack/kirov-gmu-calendar',
    fixtureId:source.fixtureId,sha256:sha,byteLength:entry.byteLength,
    packageSha256:entry.packageSha256,registrySha256:registrySha,
    originalCandidateDigest:entry.candidateDigest,originalEventSetDigest:entry.eventSetDigest,
    candidateDigest,eventSetDigest:digest,mode,publicationAllowed:false,releaseGate:'REVIEW_REQUIRED'};
  bundle.reviewOnly=true;
  return bundle;
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [repo,xlsx,out,...extra]=process.argv.slice(2);
    assert(repo && xlsx && out && extra.length===0,'expected engine-root exact XLSX output; no trusted-SHA bypass');
    same(realpathSync(repo),realpathSync(root));
    const bundle=buildReviewBundle(readFileSync(xlsx));
    writeFileSync(out,JSON.stringify(bundle)+'\n',{mode:0o600});
    console.log(JSON.stringify({sha256:bundle.reviewedSource.sha256,eventCount:bundle.parsingResult.events.length,
      eventSetDigest:bundle.reviewedSource.eventSetDigest,mode:bundle.reviewedSource.mode,publicationAllowed:false}));
  } catch(error) {
    if(error instanceof SourceNotInReviewIntake) { console.error(error.message); process.exitCode=20; }
    else { console.error(error.message);process.exitCode=1; }
  }
}
