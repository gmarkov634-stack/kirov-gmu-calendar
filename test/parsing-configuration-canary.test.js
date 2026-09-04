import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createKgmuParsingJob } from '../src/index.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const EXPECTED_GROUPS = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'];
const SOURCE_SHA256 = '341f5bce70de3b6a483f7edfe83fe37ec02e70a4aaccb043aa77a23f9222255b';
const SOURCE_OBJECT_KEY = `sources/kirov-gmu/2026-2027/semester-1/${SOURCE_SHA256}.xlsx`;

async function loadCanary() {
  const [scheduleSource, parsingProfile, sourceFixture, rulesManifest, qaEvidence, qaReport] = await Promise.all([
    readJson('../config/schedule-sources/2026-2027-semester-1/medicine-101-110.json'),
    readJson('../config/parsing-profiles/weekly.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-101-110.source.json'),
    readJson('../parser-rules/v1/manifest.json'),
    readJson('../qa/2026-2027-semester-1/medicine-101-110.evidence.json'),
    readJson('../qa/2026-2027-semester-1/medicine-101-110.qa-report.json')
  ]);
  return { scheduleSource, parsingProfile, sourceFixture, rulesManifest, qaEvidence, qaReport };
}

test('university-owned ScheduleSource is derived exactly from the current medicine 101-110 source fixture', async () => {
  const { scheduleSource, sourceFixture } = await loadCanary();

  assert.deepEqual(scheduleSource, {
    scheduleSourceId: 'medicine-101-110',
    sourceId: sourceFixture.source.sourceId,
    universityId: sourceFixture.universityId,
    academicPeriodId: sourceFixture.academicPeriodId,
    sourceObjectKey: SOURCE_OBJECT_KEY,
    mediaType: sourceFixture.source.mimeType,
    expectedGroupIds: sourceFixture.expectedGroupIds,
    parsingProfileId: sourceFixture.parserProfile
  });
  assert.equal(sourceFixture.source.sha256, SOURCE_SHA256);
  assert.deepEqual(scheduleSource.expectedGroupIds, EXPECTED_GROUPS);
});

test('university-owned ParsingProfile pins the current rule manifest without copying rule text', async () => {
  const { parsingProfile, rulesManifest, sourceFixture } = await loadCanary();

  assert.deepEqual(parsingProfile, {
    profileId: sourceFixture.parserProfile,
    universityId: rulesManifest.universityId,
    parserRulesVersion: rulesManifest.parserRulesVersion,
    acceptedMediaTypes: [sourceFixture.source.mimeType]
  });
  assert.equal(parsingProfile.parserRulesVersion, 'kgmu-2026-08-27-v3');
  assert.deepEqual(rulesManifest.profiles[parsingProfile.profileId], ['general', 'weekly']);
  assert.equal(rulesManifest.ambiguityPolicy.status, 'REVIEW_REQUIRED');
  assert.equal(rulesManifest.ambiguityPolicy.blocksPublication, true);
});

test('declarative config produces the exact legacy KGMU ParsingJob at the migration bridge', async () => {
  const { scheduleSource, parsingProfile, qaReport } = await loadCanary();
  const job = createKgmuParsingJob({
    jobId: qaReport.parsingJobId,
    academicPeriodId: scheduleSource.academicPeriodId,
    sourceId: scheduleSource.sourceId,
    sourceObjectKey: scheduleSource.sourceObjectKey,
    parserRulesVersion: parsingProfile.parserRulesVersion,
    expectedGroupIds: scheduleSource.expectedGroupIds,
    requestedAt: qaReport.createdAt
  });

  assert.equal(Object.hasOwn(job, 'scheduleSourceId'), false);
  assert.deepEqual(job, {
    jobId: 'parsing-job-101-110-latin-correction-v4',
    universityId: 'kirov-gmu',
    academicPeriodId: '2026-2027-semester-1',
    sourceId: 'medicine',
    sourceObjectKey: SOURCE_OBJECT_KEY,
    parserRulesVersion: 'kgmu-2026-08-27-v3',
    expectedGroupIds: EXPECTED_GROUPS,
    requestedAt: '2026-08-30T22:30:00+03:00'
  });
});

test('configuration bridge remains tied to the already-passed normalized candidate', async () => {
  const { scheduleSource, parsingProfile, qaEvidence, qaReport } = await loadCanary();

  assert.equal(qaReport.decision, 'pass');
  assert.equal(qaReport.candidateDigest, qaEvidence.candidateDigest);
  assert.equal(qaEvidence.sourceSha256, SOURCE_SHA256);
  assert.equal(qaEvidence.parserRulesVersion, parsingProfile.parserRulesVersion);
  assert.deepEqual(Object.keys(qaEvidence.groupEventCounts), scheduleSource.expectedGroupIds);
  assert.equal(qaEvidence.eventCount, 4349);
  assert.equal(qaEvidence.baseEventCount, 3429);
  assert.equal(qaEvidence.facultativeEventCount, 920);
  assert.equal(qaEvidence.logicalSourceCellCount, qaEvidence.coveredSourceCellCount);
  assert.equal(qaEvidence.unresolvedAmbiguities, 0);
  assert.equal(qaEvidence.duplicateEvents, 0);
});

test('declarative configuration contains no public fetch URL, raw source, or protected subscription material', async () => {
  const { scheduleSource, parsingProfile } = await loadCanary();
  const serialized = JSON.stringify({ scheduleSource, parsingProfile });

  for (const forbidden of [
    'kirovgma.ru',
    'sourceUrl',
    'rawSource',
    'CalendarSubscription',
    'CalendarPreferences',
    'Entitlement',
    'tokenHash',
    'opaqueIcsUrl'
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
