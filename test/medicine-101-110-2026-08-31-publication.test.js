import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildMedicinePublicationPlan
} from '../src/medicine-publication-plan.js';
import { digestNormalizedEvents } from '../src/explicit-decisions.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

const groups = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'];
const targetDigest = 'sha256:4834a447edd3cccf25bf1105486f34b23c64b8ab56c98db0de591e7b4da68469';
const previousDigest = 'sha256:1d56b5b52c6eb6b7e389198309e3dee6dc3b09d6f367357c977d52b2f53755bd';
const expectedCounts = {
  '101': 428,
  '102': 427,
  '103': 427,
  '104': 427,
  '105': 428,
  '106': 428,
  '107': 439,
  '108': 439,
  '109': 444,
  '110': 427
};
const expectedDefaultCounts = {
  '101': 336,
  '102': 335,
  '103': 335,
  '104': 335,
  '105': 336,
  '106': 336,
  '107': 347,
  '108': 347,
  '109': 352,
  '110': 335
};

test('updated medicine 101-110 post-QA publication evidence pins the exact compatibility-approved candidate', async () => {
  const [manifest, facultatives, source, evidence, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-101-110-2026-08-31.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.candidate-evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.qa-report.json'),
    readJson('qa/2026-2027-semester-1/medicine-101-110-2026-08-31.publication-evidence.json')
  ]);

  assert.equal(qa.decision, 'pass');
  assert.equal(qa.publicationAllowed, false);
  assert.equal(qa.compatibilityGate.status, 'pending');
  assert.equal(qa.sharedContractEvidence, null);

  assert.equal(publication.schema, 'kgmu-medicine-publication-evidence-v1');
  assert.equal(publication.sourceSha256, source.source.sha256);
  assert.equal(publication.candidateDigest, targetDigest);
  assert.equal(publication.eventSetDigest, targetDigest);
  assert.equal(publication.eventCount, 4314);
  assert.deepEqual(publication.groupEventCounts, expectedCounts);
  assert.deepEqual(publication.groupDefaultVisibleEventCounts, expectedDefaultCounts);
  assert.deepEqual(
    publication.groupFacultativeEventCounts,
    Object.fromEntries(groups.map((groupId) => [groupId, 92]))
  );
  assert.equal(publication.previousProductionCandidate.candidateDigest, previousDigest);
  assert.equal(publication.previousProductionCandidate.preserveAsSuperseded, true);
  assert.equal(publication.previousProductionCandidate.rollbackRequired, true);

  assert.equal(publication.compatibilityGateEvidence.conclusion, 'success');
  assert.equal(publication.compatibilityGateEvidence.workflowRunId, 33918531499);
  assert.equal(publication.compatibilityGateEvidence.workflowRunNumber, 6);
  assert.equal(
    publication.compatibilityGateEvidence.coreBaseCommit,
    '58368c03d487ae7e20298f45e4b24891a54df613'
  );
  assert.equal(
    publication.compatibilityGateEvidence.kgmuCandidateCommit,
    '462a5e73d6ba647debe1ec0b75efd9c9d1ff5d25'
  );
  assert.equal(
    publication.compatibilityGateEvidence.kgmuMainMergeCommit,
    '2349545ed58036e9be68b57d994d82fc3c91b00b'
  );

  assert.equal(publication.sharedContractEvidence.repository, 'gmarkov634-stack/medical-calendar-core');
  assert.equal(
    publication.sharedContractEvidence.commit,
    '58368c03d487ae7e20298f45e4b24891a54df613'
  );
  assert.equal(
    publication.sharedContractEvidence.productionRuntimeCommit,
    'e5414c1d8b8754f8e47397f24d7aeb5d413431ec'
  );
  assert.equal(
    publication.sharedContractEvidence.normalizedEventSchemaBlob,
    '027699254f920e30822ca26214ddc0746c258c3c'
  );
  assert.equal(
    publication.sharedContractEvidence.icsRendererBlob,
    'b75aea9bd6b54fab9ae454c1f7fedcf233d8ea96'
  );

  const plan = buildMedicinePublicationPlan({
    manifest,
    facultatives,
    source,
    evidence,
    qa: { ...qa, sharedContractEvidence: publication.sharedContractEvidence }
  });
  assert.equal(plan.candidateDigest, targetDigest);
  assert.equal(digestNormalizedEvents(plan.events), targetDigest);
  assert.equal(plan.events.length, 4314);
  assert.deepEqual(Object.fromEntries(groups.map((groupId) => [
    groupId,
    plan.events.filter((event) => event.groupId === groupId).length
  ])), expectedCounts);
  assert.equal(new Set(plan.events.map((event) => event.eventId)).size, 4314);
  assert.ok(plan.events.every((event) => event.timeSemantics === 'floating'));
  assert.equal(plan.versions.length, 10);
  for (const version of plan.versions) {
    assert.equal(
      version.versionId,
      `kgmu-2026-2027-s1-medicine-${version.groupId}-4834a447edd3cccf`
    );
  }
});

test('updated medicine 101-110 publisher is fail-closed around production replacement and subscription contracts', async () => {
  const source = await readFile(
    new URL('../ops/publish-medicine-101-110-2026-08-31.mjs', import.meta.url),
    'utf8'
  );
  for (const required of [
    '--replace-existing',
    'PRAGMA integrity_check',
    '.deployed-commit',
    'productionRuntimeCommit',
    'normalizedEventSchemaBlob',
    'icsRendererBlob',
    'rollbackToVersion',
    'CREATE TEMP TRIGGER',
    'protected production table mutation',
    'calendar_subscriptions',
    'entitlements',
    'subscription_tokens',
    'calendar_preferences',
    'previous production version is not preserved as superseded',
    'PREFLIGHT_OK_NO_DATABASE_CHANGES'
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.doesNotMatch(source, /function\s+protectedState|function\s+tableDigest/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+schedule_versions/i);
  assert.doesNotMatch(source, /rotate\s*token|revoke\s*token/i);
});

test('updated medicine 101-110 publisher requires an explicit replacement apply flag', async () => {
  const publisher = new URL('../ops/publish-medicine-101-110-2026-08-31.mjs', import.meta.url);
  await assert.rejects(
    execFileAsync(process.execPath, [publisher.pathname, '--apply'], { encoding: 'utf8' }),
    (error) => {
      assert.match(error.stderr, /--apply requires --replace-existing/);
      return true;
    }
  );
});

test('updated medicine 101-110 publisher preflight reproduces the exact transition plan without DB access', async () => {
  const publisher = new URL('../ops/publish-medicine-101-110-2026-08-31.mjs', import.meta.url);
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [publisher.pathname, '--preflight'],
    { encoding: 'utf8' }
  );
  assert.equal(stderr, '');
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
  assert.match(stdout, /"targetEventCount": 4314/);
  assert.match(stdout, new RegExp(targetDigest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stdout, new RegExp(previousDigest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stdout, /"compatibilityWorkflowRunId": 33918531499/);
  for (const groupId of groups) {
    assert.match(
      stdout,
      new RegExp(`kgmu-2026-2027-s1-medicine-${groupId}-1d56b5b52c6eb6b7`)
    );
    assert.match(
      stdout,
      new RegExp(`kgmu-2026-2027-s1-medicine-${groupId}-4834a447edd3cccf`)
    );
  }
});
