import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createKgmuParsingJob } from '../src/index.js';
import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

const [source, sourceArtifact, parsingJob, decisions, semantic, evidence, qa] = await Promise.all([
  readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.source.json'),
  readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.source-artifact.json'),
  readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.parsing-job.json'),
  readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.decisions.json'),
  readJson('qa/2026-2027-semester-1/pediatrics-631-637.semantic-review.json'),
  readJson('qa/2026-2027-semester-1/pediatrics-631-637.evidence.json'),
  readJson('qa/2026-2027-semester-1/pediatrics-631-637.qa-report.json')
]);

const events = expandExplicitDecisionManifest(decisions, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});

const candidateDigest = digestNormalizedEvents(events);

test('source artifact and ParsingJob are pinned to the same immutable source evidence', () => {
  assert.equal(sourceArtifact.sourceArtifactId, 'source-artifact-pediatrics-631-637-2026-09-02-v1');
  assert.equal(sourceArtifact.sha256, source.source.sha256);
  assert.equal(sourceArtifact.byteLength, source.source.byteLength);
  assert.equal(sourceArtifact.originUrl, source.source.url);
  assert.equal(sourceArtifact.productionObjectStorageWritePerformed, false);
  assert.equal(sourceArtifact.publicationPerformed, false);

  const builtJob = createKgmuParsingJob(parsingJob);
  assert.deepEqual(builtJob, parsingJob);
  assert.equal(parsingJob.sourceObjectKey, sourceArtifact.sourceObjectKey);
  assert.deepEqual(parsingJob.expectedGroupIds, source.expectedGroupIds);
  assert.equal(parsingJob.parserRulesVersion, source.parserRulesVersion);
});

test('semantic review and QA are pinned to the deterministic normalized candidate', () => {
  assert.equal(events.length, 679);
  assert.equal(candidateDigest, 'sha256:5cf638779377057eb6307a460f669505c291e781fb59ceb81add089f732d263b');
  assert.equal(evidence.candidate.candidateDigest, candidateDigest);
  assert.equal(qa.candidateDigest, candidateDigest);
  assert.equal(qa.parsingJobId, parsingJob.jobId);
  assert.equal(qa.decision, 'pass');
  assert.equal(semantic.status, 'SEMANTIC_QA_PASS');
  assert.equal(semantic.unresolvedAmbiguities, 0);
  assert.equal(evidence.ambiguities.unresolved, 0);
});

test('normalized draft QA pass does not authorize publication', () => {
  assert.equal(semantic.publicationEligible, false);
  assert.equal(semantic.publicationPerformed, false);
  assert.equal(evidence.publication.eligible, false);
  assert.equal(evidence.publication.performed, false);

  const publicationCheck = qa.checks.find((check) => check.code === 'publication-path-date-only-support');
  assert.ok(publicationCheck);
  assert.equal(publicationCheck.status, 'warning');
  assert.match(publicationCheck.message, /publication remains blocked/i);
});

test('core date-only dependency is exact and CI-verified', () => {
  const contract = evidence.pipeline.sharedNormalizedContract;
  assert.equal(contract.repository, 'gmarkov634-stack/medical-calendar-core');
  assert.equal(contract.pullRequest, 245);
  assert.equal(contract.headCommit, '8d54784d8407ccc1fc817aa060039bc783f41fdf');
  assert.equal(contract.normalizedEventSchemaBlob, '264f87a5b655315f8f5d41538525b5d4382a7aa9');
  assert.equal(contract.coreCiRunId, 33594068472);
  assert.equal(contract.coreCiConclusion, 'success');
});
