import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createKgmuParsingJob } from '../src/index.js';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const EXPECTED_GROUPS = ['111','112','113','114','115','116','117','118','119','120'];
const SOURCE_SHA256 = '781acc69637de634c25738d455cf0f8226212f8eeb1ef016a68c659ec20e358e';
const SOURCE_OBJECT_KEY = `sources/kirov-gmu/2026-2027/semester-1/${SOURCE_SHA256}.xlsx`;
const CANDIDATE_DIGEST = 'sha256:28356b9ed1d15678252842e7ebee5c19ddd66b8221b6382e09322db0eea6aa71';

async function loadCanary() {
  const [scheduleSource, parsingProfile, sourceFixture, qaEvidence, qaReport] = await Promise.all([
    readJson('../config/schedule-sources/2026-2027-semester-1/medicine-111-120.json'),
    readJson('../config/parsing-profiles/weekly.json'),
    readJson('../fixtures/2026-2027-semester-1/medicine-111-120.source.json'),
    readJson('../qa/2026-2027-semester-1/medicine-111-120.evidence.json'),
    readJson('../qa/2026-2027-semester-1/medicine-111-120.qa-report.json')
  ]);
  return { scheduleSource, parsingProfile, sourceFixture, qaEvidence, qaReport };
}

test('second medicine stream has independent ScheduleSource identity while preserving source family', async () => {
  const { scheduleSource, sourceFixture } = await loadCanary();

  assert.deepEqual(scheduleSource, {
    scheduleSourceId: 'medicine-111-120',
    sourceId: sourceFixture.source.sourceId,
    universityId: sourceFixture.universityId,
    academicPeriodId: sourceFixture.academicPeriodId,
    sourceObjectKey: SOURCE_OBJECT_KEY,
    mediaType: sourceFixture.source.mimeType,
    expectedGroupIds: sourceFixture.expectedGroupIds,
    parsingProfileId: sourceFixture.parserProfile
  });
  assert.equal(scheduleSource.sourceId, 'medicine');
  assert.equal(sourceFixture.source.sha256, SOURCE_SHA256);
  assert.deepEqual(scheduleSource.expectedGroupIds, EXPECTED_GROUPS);
});

test('second medicine stream resolves to the unchanged legacy KGMU ParsingJob shape', async () => {
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
  assert.equal(job.sourceId, 'medicine');
  assert.equal(job.sourceObjectKey, SOURCE_OBJECT_KEY);
  assert.deepEqual(job.expectedGroupIds, EXPECTED_GROUPS);
  assert.equal(job.jobId, 'parsing-job-111-120-2026-2027-s1-v1');
});

test('second medicine source config is pinned to its existing approved QA candidate', async () => {
  const { scheduleSource, parsingProfile, qaEvidence, qaReport } = await loadCanary();

  assert.equal(qaReport.decision, 'pass');
  assert.equal(qaReport.candidateDigest, CANDIDATE_DIGEST);
  assert.equal(qaEvidence.candidateDigest, CANDIDATE_DIGEST);
  assert.equal(qaEvidence.sourceSha256, SOURCE_SHA256);
  assert.equal(qaEvidence.parserRulesVersion, parsingProfile.parserRulesVersion);
  assert.deepEqual(Object.keys(qaEvidence.groupEventCounts), scheduleSource.expectedGroupIds);
  assert.deepEqual(qaEvidence.groupEventCounts, {
    '111': 428,
    '112': 428,
    '113': 428,
    '114': 427,
    '115': 427,
    '116': 428,
    '117': 423,
    '118': 423,
    '119': 445,
    '120': 428
  });
  assert.equal(qaEvidence.eventCount, 4285);
  assert.equal(qaEvidence.baseEventCount, 3365);
  assert.equal(qaEvidence.facultativeEventCount, 920);
  assert.equal(qaEvidence.logicalSourceCellCount, 147);
  assert.equal(qaEvidence.coveredSourceCellCount, 147);
  assert.equal(qaEvidence.unresolvedAmbiguities, 0);
  assert.equal(qaEvidence.duplicateEvents, 0);
});

test('second medicine schedule configuration contains no public URL or subscriber material', async () => {
  const { scheduleSource, parsingProfile } = await loadCanary();
  const serialized = JSON.stringify({ scheduleSource, parsingProfile });
  for (const forbidden of [
    'kirovgma.ru',
    'sourceUrl',
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
