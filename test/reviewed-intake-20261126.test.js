import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {validatePackage,validateRegistry} from '../tools/validate_reviewed_intake.mjs';
const directory=new URL('../qa/2026-2027-semester-1/intake-2026-11-26/',import.meta.url);
const registry=JSON.parse(readFileSync(new URL('registry.json',directory),'utf8'));
const entry=registry.sources.find(s=>s.package);
const pkg=()=>JSON.parse(gunzipSync(readFileSync(new URL(entry.package,directory))));
test('all 20 exact-source registry entries and 12 guarded package payloads validate',()=>{
 assert.deepEqual(validateRegistry(),{known:8,reviewed:12,events:22876,publicationAllowed:false,releaseGate:'REVIEW_REQUIRED'});
});
test('publication flag cannot be opened by mutating the archive envelope',()=>{
 const p=pkg();p.publicationAllowed=true;assert.throws(()=>validatePackage(p,entry));
});
test('artifact content tampering is rejected',()=>{
 const p=pkg();p.artifacts[0].content+=' ';assert.throws(()=>validatePackage(p,entry));
});
test('cross-SHA package substitution is rejected',()=>{
 const p=pkg();p.source.sourceSha256='0'.repeat(64);assert.throws(()=>validatePackage(p,entry));
});
test('changed event count or digest is rejected',()=>{
 const p=pkg();p.eventCount++;assert.throws(()=>validatePackage(p,entry));
 const q=pkg();q.eventSetDigest='sha256:'+'0'.repeat(64);assert.throws(()=>validatePackage(q,entry));
});
