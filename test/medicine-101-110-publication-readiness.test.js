import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildMedicinePublicationPlan } from '../src/medicine-publication-plan.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const sumValues = (record) => Object.values(record).reduce((sum, value) => sum + value, 0);

test('medicine 101-110 publication readiness is additive, exact-candidate-bound and production-runtime-compatible', async () => {
  const [
    manifest,
    facultatives,
    source,
    candidateEvidence,
    pendingQa,
    publicationEvidence,
    publicationQa,
  ] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.candidate-evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.publication-evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.publication-qa-report.json'),
  ]);

  // Preserve the earlier fail-closed checkpoint as immutable audit evidence.
  assert.equal(pendingQa.publicationAllowed, false);
  assert.equal(pendingQa.compatibilityGate.status, 'pending');
  assert.equal(pendingQa.sharedContractEvidence, null);
  assert.equal(source.lifecycle.publicationAllowed, false);
  assert.equal(candidateEvidence.publicationAllowed, false);
  assert.equal(candidateEvidence.compatibilityStatus, 'pending');

  assert.equal(publicationEvidence.publicationAllowed, true);
  assert.equal(publicationQa.publicationAllowed, true);
  assert.equal(publicationQa.decision, 'pass');
  assert.equal(publicationQa.compatibilityGate.status, 'pass');
  assert.equal(publicationQa.checks.some((check) => check.status === 'fail'), false);

  assert.equal(publicationEvidence.sourceSha256, source.source.sha256);
  assert.equal(publicationEvidence.candidateDigest, candidateEvidence.candidateDigest);
  assert.equal(publicationEvidence.eventSetDigest, candidateEvidence.candidateDigest);
  assert.equal(publicationQa.candidateDigest, candidateEvidence.candidateDigest);
  assert.equal(publicationQa.parsingJobId, pendingQa.parsingJobId);
  assert.deepEqual(publicationQa.sharedContractEvidence, publicationEvidence.sharedContractEvidence);

  assert.equal(publicationEvidence.compatibilityValidation.coreBaseCommit, '58368c03d487ae7e20298f45e4b24891a54df613');
  assert.equal(publicationEvidence.compatibilityValidation.validationCommit, 'f87f401bae76cc77a63392c061a231d1ff5aad35');
  assert.equal(publicationEvidence.compatibilityValidation.kgmuReviewedCommit, '462a5e73d6ba647debe1ec0b75efd9c9d1ff5d25');
  assert.equal(publicationEvidence.compatibilityValidation.workflowRunId, 33918531499);
  assert.equal(publicationEvidence.compatibilityValidation.conclusion, 'success');

  assert.equal(publicationEvidence.sharedContractEvidence.productionRuntimeCommit, 'e5414c1d8b8754f8e47397f24d7aeb5d413431ec');
  assert.equal(publicationEvidence.sharedContractEvidence.publicationScheduleBlob, '6a3b8b4efc946133ba665712cf910720e5979d7b');
  assert.equal(publicationEvidence.sharedContractEvidence.normalizedEventSchemaBlob, '027699254f920e30822ca26214ddc0746c258c3c');
  assert.equal(publicationEvidence.sharedContractEvidence.icsRendererBlob, 'b75aea9bd6b54fab9ae454c1f7fedcf233d8ea96');
  assert.deepEqual(publicationEvidence.productionRuntimeParity, {
    method: 'publication-contract-blob-parity',
    coreMainCommit: '58368c03d487ae7e20298f45e4b24891a54df613',
    productionRuntimeCommit: 'e5414c1d8b8754f8e47397f24d7aeb5d413431ec',
    publicationScheduleBlob: '6a3b8b4efc946133ba665712cf910720e5979d7b',
    normalizedEventSchemaBlob: '027699254f920e30822ca26214ddc0746c258c3c',
    icsRendererBlob: 'b75aea9bd6b54fab9ae454c1f7fedcf233d8ea96',
  });

  const plan = buildMedicinePublicationPlan({
    manifest,
    facultatives,
    source,
    evidence: candidateEvidence,
    qa: publicationQa,
  });

  assert.equal(plan.sourceSha256, publicationEvidence.sourceSha256);
  assert.equal(plan.candidateDigest, publicationEvidence.candidateDigest);
  assert.equal(plan.events.length, 4314);
  assert.equal(plan.versions.length, 10);
  assert.equal(sumValues(publicationEvidence.groupEventCounts), 4314);
  assert.equal(sumValues(publicationEvidence.groupDefaultVisibleEventCounts), 3394);
  assert.equal(sumValues(publicationEvidence.groupFacultativeEventCounts), 920);
  assert.equal(plan.events.filter((event) => event.facultativeId == null).length, 3394);
  assert.equal(plan.events.filter((event) => event.facultativeId != null).length, 920);

  const versionCounts = Object.fromEntries(plan.versions.map(({ groupId, eventCount }) => [groupId, eventCount]));
  assert.deepEqual(versionCounts, publicationEvidence.groupEventCounts);
  for (const version of plan.versions) {
    assert.equal(
      version.versionId,
      `kgmu-2026-2027-s1-medicine-${version.groupId}-4834a447edd3cccf`,
    );
  }

  assert.equal(plan.coreEvidence.productionRuntimeCommit, publicationEvidence.sharedContractEvidence.productionRuntimeCommit);
  assert.equal(plan.coreEvidence.publicationScheduleBlob, publicationEvidence.sharedContractEvidence.publicationScheduleBlob);
  assert.equal(plan.coreEvidence.normalizedEventSchemaBlob, publicationEvidence.sharedContractEvidence.normalizedEventSchemaBlob);
  assert.equal(plan.coreEvidence.icsRendererBlob, publicationEvidence.sharedContractEvidence.icsRendererBlob);
});
