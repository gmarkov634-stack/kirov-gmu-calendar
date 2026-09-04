import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createKgmuParsingJob } from '../src/index.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const EXPECTED_GROUPS = ['291', '292', '293', '294'];
const SOURCE_SHA256 = 'ec51c194d2f91d33230da4d93d8bad1dfe885d70ec4bd0e2eec959071b4ff610';
const SOURCE_OBJECT_KEY = `sources/kirov-gmu/2026-2027/semester-1/${SOURCE_SHA256}.xlsx`;
const CANDIDATE_DIGEST = 'sha256:6b47e359d9910ed04e84e059ea021a6901bf27b461b82c131c9e3f2e7c664c60';

async function loadCanary() {
  const [
    scheduleSource,
    parsingProfile,
    sourceFixture,
    parsingJob,
    rulesManifest,
    normalizedDraft,
    qaEvidence,
    qaReport
  ] = await Promise.all([
    readJson('../config/schedule-sources/2026-2027-semester-1/dentistry-291-294.json'),
    readJson('../config/parsing-profiles/mixed.json'),
    readJson('../fixtures/2026-2027-semester-1/dentistry-291-294.source.json'),
    readJson('../fixtures/2026-2027-semester-1/dentistry-291-294.parsing-job.json'),
    readJson('../parser-rules/v1/manifest.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-291-294.evidence.json'),
    readJson('../qa/2026-2027-semester-1/dentistry-291-294.qa-report.json')
  ]);
  return {
    scheduleSource,
    parsingProfile,
    sourceFixture,
    parsingJob,
    rulesManifest,
    normalizedDraft,
    qaEvidence,
    qaReport
  };
}

test('dentistry mixed ScheduleSource is derived exactly from its immutable source fixture', async () => {
  const { scheduleSource, sourceFixture } = await loadCanary();

  assert.deepEqual(scheduleSource, {
    sourceId: sourceFixture.source.sourceId,
    universityId: sourceFixture.universityId,
    academicPeriodId: sourceFixture.academicPeriodId,
    sourceObjectKey: SOURCE_OBJECT_KEY,
    mediaType: sourceFixture.source.mimeType,
    expectedGroupIds: sourceFixture.expectedGroupIds,
    parsingProfileId: sourceFixture.parserProfile
  });
  assert.equal(sourceFixture.source.sha256, SOURCE_SHA256);
  assert.equal(sourceFixture.source.objectKey, SOURCE_OBJECT_KEY);
  assert.deepEqual(scheduleSource.expectedGroupIds, EXPECTED_GROUPS);
});

test('mixed ParsingProfile selects general weekly and mixed rules without copying rule text', async () => {
  const { parsingProfile, rulesManifest, sourceFixture } = await loadCanary();

  assert.deepEqual(parsingProfile, {
    profileId: sourceFixture.parserProfile,
    universityId: rulesManifest.universityId,
    parserRulesVersion: sourceFixture.parserRulesVersion,
    acceptedMediaTypes: [sourceFixture.source.mimeType]
  });
  assert.equal(parsingProfile.parserRulesVersion, 'kgmu-2026-08-27-v3');
  assert.deepEqual(rulesManifest.profiles[parsingProfile.profileId], ['general', 'weekly', 'mixed']);
  assert.equal(rulesManifest.ambiguityPolicy.status, 'REVIEW_REQUIRED');
  assert.equal(rulesManifest.ambiguityPolicy.blocksPublication, true);
  assert.equal(rulesManifest.ambiguityPolicy.guessingAllowed, false);
});

test('dentistry mixed declarative config produces the exact existing canonical ParsingJob', async () => {
  const { scheduleSource, parsingProfile, parsingJob } = await loadCanary();

  const resolved = createKgmuParsingJob({
    jobId: parsingJob.jobId,
    academicPeriodId: scheduleSource.academicPeriodId,
    sourceId: scheduleSource.sourceId,
    sourceObjectKey: scheduleSource.sourceObjectKey,
    parserRulesVersion: parsingProfile.parserRulesVersion,
    expectedGroupIds: scheduleSource.expectedGroupIds,
    requestedAt: parsingJob.requestedAt
  });

  assert.deepEqual(resolved, parsingJob);
});

test('dentistry mixed config remains tied to the passed 1066-event floating normalized candidate', async () => {
  const {
    scheduleSource,
    parsingProfile,
    normalizedDraft,
    qaEvidence,
    qaReport
  } = await loadCanary();

  assert.equal(qaReport.decision, 'pass');
  assert.equal(qaReport.candidateDigest, CANDIDATE_DIGEST);
  assert.equal(normalizedDraft.candidateDigest, CANDIDATE_DIGEST);
  assert.equal(normalizedDraft.status, 'PASS');
  assert.equal(normalizedDraft.parserProfile, 'mixed');
  assert.equal(normalizedDraft.parserRulesVersion, parsingProfile.parserRulesVersion);
  assert.deepEqual(normalizedDraft.expectedGroupIds, scheduleSource.expectedGroupIds);
  assert.equal(normalizedDraft.eventCount, 1066);
  assert.equal(normalizedDraft.events.length, 1066);
  assert.deepEqual(normalizedDraft.groupEventCounts, {
    '291': 265,
    '292': 266,
    '293': 266,
    '294': 269
  });
  assert.equal(normalizedDraft.events.every((event) => event.timeSemantics === 'floating'), true);
  assert.equal(normalizedDraft.events.filter((event) => event.assessment != null).length, 395);
  assert.equal(qaEvidence.finalNormalizedDraft.assessmentEventCount, 395);
  assert.equal(qaEvidence.finalNormalizedDraft.normalizedEventV1Compatible, true);
  assert.equal(qaEvidence.scheduleCoverage.unmatched.length, 0);
  assert.equal(qaEvidence.qaResolution.unresolvedCountNotes, 0);
});

test('dentistry mixed declarative config contains no fetch URL or protected subscriber material', async () => {
  const { scheduleSource, parsingProfile } = await loadCanary();
  const serialized = JSON.stringify({ scheduleSource, parsingProfile });

  for (const forbidden of [
    'kirovgma.ru',
    'sourceUrl',
    'originUrl',
    'rawSource',
    'CalendarSubscription',
    'CalendarPreferences',
    'Entitlement',
    'SubscriptionToken',
    'tokenHash',
    'opaqueIcsUrl'
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
