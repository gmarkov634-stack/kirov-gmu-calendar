#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../src/explicit-decisions.js';
import { runPediatricsPublication } from './lib/publish-pediatrics-course.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function countByGroup(events) {
  const counts = {};
  for (const event of events) counts[event.groupId] = (counts[event.groupId] ?? 0) + 1;
  return counts;
}

function stableVersionId({ academicPeriodId, programId, groupId, candidateDigest }) {
  const match = academicPeriodId.match(/^\d{4}-\d{4}-semester-(\d+)$/);
  if (!match) throw new Error(`unsupported academicPeriodId for stable version id: ${academicPeriodId}`);
  const digest = assertNonEmptyString(candidateDigest, 'candidateDigest').replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/i.test(digest)) throw new TypeError('candidateDigest must be a SHA-256 digest');
  return `kgmu-2026-2027-s${match[1]}-${programId}-${groupId}-${digest.slice(0, 16)}`;
}

async function loadPlan() {
  const [manifest, source, evidence, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-331-337.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-331-337.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-331-337.publication-evidence.json')
  ]);

  if (source.universityId !== 'kirov-gmu') throw new Error(`unexpected universityId: ${source.universityId}`);
  if (source.programId !== 'pediatrics') throw new Error(`unexpected programId: ${source.programId}`);
  if (source.course !== 3) throw new Error(`unexpected course: ${source.course}`);
  if (source.academicYear !== '2026-2027' || source.academicPeriodId !== '2026-2027-semester-1') {
    throw new Error('unexpected academic period');
  }
  const sourceSha256 = assertNonEmptyString(source.source?.sha256, 'source.source.sha256');
  if (manifest.sourceSha256 !== sourceSha256 || evidence.sourceSha256 !== sourceSha256 || qa.sourceSha256 !== sourceSha256) {
    throw new Error('course-3 source SHA-256 evidence mismatch');
  }
  if (publication.sourceSha256 !== sourceSha256) throw new Error('publication/source SHA-256 mismatch');
  if (manifest.parserRulesVersion !== source.parserRulesVersion) throw new Error('manifest/source parserRulesVersion mismatch');
  if (qa.decision !== 'pass' || !Array.isArray(qa.blockingIssues) || qa.blockingIssues.length !== 0) {
    throw new Error('QA decision must be pass with no blocking issues before publication');
  }
  if (qa.publicationGate?.candidateQaPass !== true) throw new Error('candidate publication QA gate is not pass');
  if (!Array.isArray(publication.checks) || publication.checks.some((check) => check?.status === 'fail')) {
    throw new Error('publication evidence contains a failing check');
  }

  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const candidateDigest = digestNormalizedEvents(events);
  for (const [label, expected] of [
    ['manifest', manifest.candidateDigest],
    ['candidate evidence', evidence.candidateDigest],
    ['QA', qa.candidateDigest],
    ['publication evidence', publication.candidateDigest]
  ]) {
    if (candidateDigest !== expected) throw new Error(`${label} candidate digest mismatch: ${candidateDigest}`);
  }
  if (events.length !== evidence.eventCount || events.length !== publication.eventCount) {
    throw new Error(`course-3 event count mismatch: ${events.length}`);
  }
  if (!Array.isArray(source.expectedGroupIds) || JSON.stringify(source.expectedGroupIds) !== JSON.stringify(manifest.groupTable)) {
    throw new Error('course-3 group table mismatch');
  }
  if (events.some((event) => event.timeSemantics !== 'floating')) {
    throw new Error('course-3 publication candidate must contain floating events only');
  }
  if (events.some((event) => event.facultativeId != null)) {
    throw new Error('course-3 candidate unexpectedly contains facultative events');
  }

  const actualCounts = countByGroup(events);
  for (const groupId of source.expectedGroupIds) {
    const expected = evidence.groupEventCounts?.[groupId];
    if (actualCounts[groupId] !== expected || publication.groupEventCounts?.[groupId] !== expected) {
      throw new Error(`group ${groupId} event count evidence mismatch`);
    }
  }
  if (Object.keys(actualCounts).length !== source.expectedGroupIds.length) throw new Error('candidate contains unexpected groups');

  const versions = source.expectedGroupIds.map((groupId) => ({
    groupId,
    versionId: stableVersionId({
      academicPeriodId: source.academicPeriodId,
      programId: source.programId,
      groupId,
      candidateDigest
    }),
    eventCount: actualCounts[groupId]
  }));

  return {
    plan: {
      universityId: source.universityId,
      programId: source.programId,
      academicYearId: source.academicYear,
      academicPeriodId: source.academicPeriodId,
      sourceId: source.source.sourceId,
      sourceSha256,
      candidateDigest,
      coreEvidence: publication.sharedContractEvidence,
      events,
      versions,
      parsingResult: {
        jobId: publication.parsingJobId,
        universityId: source.universityId,
        academicPeriodId: source.academicPeriodId,
        events
      }
    },
    qaForPublication: {
      qaReportId: publication.qaReportId,
      parsingJobId: publication.parsingJobId,
      candidateDigest,
      decision: 'pass',
      checks: publication.checks,
      createdAt: publication.createdAt
    }
  };
}

function verifyCourse3Ics({ core, published, version, unfoldIcs, countVevents }) {
  const ics = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ педиатрия ${version.groupId}`
  }));
  if (countVevents(ics) !== version.eventCount) {
    throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
  }
  if (published.events.some((event) => event.assessment) && !ics.includes('DESCRIPTION:')) {
    throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }
  if (published.events.some((event) => event.lessonType === 'lecture') && !ics.includes('ЛЕКЦ.')) {
    throw new Error(`group ${version.groupId} lecture display prefix is missing from rendered ICS`);
  }
}

const { plan, qaForPublication } = await loadPlan();
await runPediatricsPublication({
  apply: APPLY,
  plan,
  qaForPublication,
  result: 'PRODUCTION_PEDIATRICS_COURSE_3_SCHEDULES_PUBLISHED_AND_VERIFIED',
  verifyPublishedIcs: verifyCourse3Ics
});
