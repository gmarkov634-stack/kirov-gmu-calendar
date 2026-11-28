import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestNormalizedEvents } from '../src/explicit-decisions.js';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const validSha = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const parse = (b) => JSON.parse(b.toString('utf8'));
const safePath = (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\') && p.split('/').every(s => s !== '..' && s !== '.' && s !== '');
const readJson = (p) => parse(readFileSync(p));
const same = (a,b) => assert.deepEqual(a,b);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryDir = resolve(root, 'qa/2026-2027-semester-1/intake-2026-11-26');

export function validatePackage(pkg, entry) {
  same(pkg.schema,'kgmu-local-reviewed-candidate-package-v1');
  same(pkg.publicationAllowed,false);same(pkg.releaseGate,'REVIEW_REQUIRED');
  same(pkg.source.publicationAllowed,false);same(pkg.source.rawXlsxCommitted,false);
  for(const key of ['sourceSha256','byteLength','sourceUrl','program','label'])same(pkg.source[key],entry[key]);
  same(pkg.platformCompatibility.publicationPerformed,false);
  same(pkg.platformCompatibility.canonicalCI,'PENDING');
  same(pkg.platformCompatibility.scope,entry.platformCompatibility);
  same(pkg.originalEvidenceSha256,entry.originalEvidenceSha256);
  same(pkg.candidateDigest,entry.candidateDigest);same(pkg.eventSetDigest,entry.eventSetDigest);
  same(pkg.eventCount,entry.eventCount);same(pkg.groupCounts,entry.groupCounts);
  const files=new Map();assert(Array.isArray(pkg.artifacts)&&pkg.artifacts.length>0);
  for(const f of pkg.artifacts){
    assert(safePath(f.path) && /\.(json|py|mjs)$/.test(f.path),'unexpected artifact path');
    assert(!files.has(f.path),'duplicate artifact');
    assert(validSha(f.sha256));const bytes=Buffer.from(f.content,'utf8');
    same(bytes.length,f.byteLength);same(hash(bytes),f.sha256);files.set(f.path,f);
  }
  const file = (name) => {const f=files.get(name);assert(f,'missing original artifact '+name);return f;};
  const get = (name) => parse(Buffer.from(file(name).content));
  same(file(pkg.originalEvidencePath).sha256,pkg.originalEvidenceSha256);
  const ev=get(pkg.originalEvidencePath);same(ev.publicationAllowed,false);same(ev.sourceSha256,entry.sourceSha256);
  const original=get(pkg.originalCandidatePath), events=original.events ?? original.parsingResult?.events;
  assert(Array.isArray(events));same(events.length,entry.eventCount);
  same(digestNormalizedEvents(events),entry.eventSetDigest);
  const expectedDigest=original.candidateDigest??original.qaReport?.candidateDigest;
  if(expectedDigest!==undefined)same(expectedDigest,entry.candidateDigest);
  const sourceDoc=get(pkg.originalSourcePath);
  const source=sourceDoc.source?.source??sourceDoc.source;
  same(source.sha256,entry.sourceSha256);same(source.byteLength,entry.byteLength);
  const qaDoc=get(pkg.originalQaPath), qa=qaDoc.qaReport??qaDoc;
  same(qa.publicationAllowed,false);
  if(qa.decision!==undefined)same(qa.decision,'pass');
  if(pkg.eventSetDigest!==pkg.candidateDigest) {
    // Earlier course-1 legacy QA records the historical candidate digest
    // separately from the complete event-array digest. Require both exact audited values.
    same(entry.sourceSha256,'a0ea58290bd5e3a3de909b48e3ea9f1c69217b7134185d2606b56cd78e1029e5');
    const compat=[...files.values()].find(f=>f.path.endsWith('.local-compatibility-evidence.json'));
    assert(compat,'legacy digest evidence missing');
    const c=parse(Buffer.from(compat.content));same(c.eventSetDigest,pkg.eventSetDigest);same(c.candidateDigest,pkg.candidateDigest);
  }
  assert(new Set(events.map(e=>e.eventId)).size===events.length,'duplicate eventId');
  const counts={};
  for(const e of events){
    assert(typeof e.eventId==='string'&&e.eventId.startsWith('kgmu-'));
    assert(typeof e.groupId==='string'&&/^\d{3}$/.test(e.groupId));
    assert(typeof e.sourceRef?.sourceId==='string'&&e.sourceRef.sourceId.length>0);
    assert(typeof e.sourceRef?.locator==='string'&&e.sourceRef.locator.includes('!'),'source provenance missing');
    counts[e.groupId]=(counts[e.groupId]??0)+1;
  }
  same(counts,entry.groupCounts);
  if(pkg.platformCompatibility.scope==='ISOLATED_PR61'){
    same(entry.sourceSha256,'55f6431357309340f3a075d807814fa5ff3dd982d16230792ee24ec5f0e5cdff');
    same(ev.localTestsPassed,32);same(ev.releaseGate,'REVIEW_REQUIRED');same(ev.directPublicationRejected,true);
    const prov=original.eventProvenanceById;assert(prov);same(Object.keys(prov).length,588);
    const kinds={};for(const e of events){const p=prov[e.eventId];assert(p?.appliedRules?.length);kinds[p.eventKind]=(kinds[p.eventKind]??0)+1;if(p.eventKind==='INFO'){same(e.timeSemantics,'date-only');assert(!('startTime'in e)&&!('endTime'in e));same(e.location,null);}}
    same(kinds,{MANDATORY:492,INFO:96});same(ev.sourceBackedOverlapWarnings.length,3);
  }
  return pkg.eventCount;
}

export function validateRegistry({directory=registryDir,repository=root}={}){
  const registry=readJson(resolve(directory,'registry.json'));
  same(registry.schema,'kgmu-reviewed-intake-registry-v1');same(registry.releaseGate,'REVIEW_REQUIRED');same(registry.publicationAllowed,false);
  const indexBytes=readFileSync(resolve(directory,'local-review-index.json'));same(hash(indexBytes),registry.localIndexSha256);
  const index=parse(indexBytes);same(index.publicationAllowed,false);
  same(registry.sources.length,20);same(index.sources.length,20);
  same(registry.knownExactSources,8);same(registry.reviewedCandidates,12);
  assert(new Set(registry.sources.map(s=>s.sourceSha256)).size===20);
  let known=0,reviewed=0,events=0;
  const faculty={};
  for(const entry of registry.sources){
    assert(validSha(entry.sourceSha256));same(entry.publicationAllowed,false);same(entry.rawXlsxCommitted,false);
    const row=index.sources.find(x=>x.sha256===entry.sourceSha256);assert(row);
    same(row.program,entry.program);same(row.label,entry.label);same(row.bytes,entry.byteLength);same(row.url,entry.sourceUrl);
    faculty[entry.program]=(faculty[entry.program]??0)+1;
    if(entry.status==='KNOWN_EXACT_SOURCE'){
      known++;same(row.status,'KNOWN_SOURCE');assert(safePath(entry.fixture)&&entry.fixture.endsWith('.source.json')&&!entry.fixture.includes('/'));
      const fixture=readJson(resolve(repository,'fixtures',registry.academicPeriod,entry.fixture));
      same(fixture.source.sha256,entry.sourceSha256);same(fixture.source.byteLength,entry.byteLength);
      assert(!entry.package);continue;
    }
    same(entry.status,'LOCAL_SEMANTIC_QA_PASS_RELEASE_BLOCKED');same(row.status,'REVIEW_REQUIRED');
    assert(row.review_status.includes('SEMANTIC_QA_PASS'));
    if(row.review_evidence_sha256)same(row.review_evidence_sha256,entry.originalEvidenceSha256);
    reviewed++;assert(safePath(entry.package)&&entry.package.startsWith('packages/')&&entry.package.endsWith('.json.gz'));
    const bytes=readFileSync(resolve(directory,entry.package));
    same(bytes.length,entry.packageBytes);same(hash(bytes),entry.packageSha256);
    const raw=gunzipSync(bytes,{maxOutputLength:16*1024*1024});
    same(hash(raw),entry.uncompressedSha256);events+=validatePackage(parse(raw),entry);
  }
  same(faculty,{medicine:9,pediatrics:6,dentistry:5});same(known,8);same(reviewed,12);same(events,22876);
  return {known,reviewed,events,publicationAllowed:false,releaseGate:'REVIEW_REQUIRED'};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(validateRegistry()));
