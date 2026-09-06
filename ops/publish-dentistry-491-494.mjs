#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestNormalizedEvents } from '../src/explicit-decisions.js';
import { runDentistryPublication } from './lib/publish-dentistry-course.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

const UNIVERSITY_ID = 'kirov-gmu';
const PROGRAM_ID = 'dentistry';
const ACADEMIC_YEAR_ID = '2026-2027';
const ACADEMIC_PERIOD_ID = '2026-2027-semester-1';
const GROUPS = ['491', '492', '493', '494'];
const SOURCE_SHA256 = '2e945ca99ec75bfbe7f98402d0752ebe96afbd12780d29c7f5cdf32f7e22b265';
const CANDIDATE_DIGEST = 'sha256:73cb833fb0f175a449e488c0125153e94f5528f5eebd0d46f5dab7719341ac15';
const EXPECTED_COUNTS = Object.freeze({ '491': 133, '492': 133, '493': 133, '494': 132 });
const EXPECTED_DATE_ONLY_COUNTS = Object.freeze({ '491': 12, '492': 12, '493': 12, '494': 12 });

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

function coreQaChecks(qa) {
  return qa.checks.map((check) => ({
    code: assertNonEmptyString(check.name, 'qa.check.name'),
    status: check.status === 'PASS' ? 'pass' : check.status === 'WARNING' ? 'warning' : 'fail',
    message: check.detail == null ? null : typeof check.detail === 'string' ? check.detail : JSON.stringify(check.detail)
  }));
}

async function loadPlan() {
  const [sourceArtifact, parsingJob, draft, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/dentistry-491-494.source-artifact.json'),
    readJson('fixtures/2026-2027-semester-1/dentistry-491-494.parsing-job.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.normalized-draft.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.qa-report.json'),
    readJson('qa/2026-2027-semester-1/dentistry-491-494.publication-evidence.json')
  ]);

  if (sourceArtifact.universityId !== UNIVERSITY_ID || sourceArtifact.sourceId !== PROGRAM_ID) throw new Error('unexpected Dentistry course-4 source identity');
  if (sourceArtifact.academicPeriodId !== ACADEMIC_PERIOD_ID) throw new Error('unexpected academic period');
  if (sourceArtifact.sha256 !== SOURCE_SHA256 || parsingJob.sourceSha256 !== SOURCE_SHA256 || draft.sourceSha256 !== SOURCE_SHA256 || qa.sourceSha256 !== SOURCE_SHA256 || publication.sourceSha256 !== SOURCE_SHA256) throw new Error('Dentistry course-4 source SHA-256 evidence mismatch');
  if (draft.parserRulesVersion !== parsingJob.parserRulesVersion) throw new Error('Dentistry course-4 parser evidence mismatch');
  if (draft.status !== 'PASS' || qa.status !== 'PASS' || qa.publishEligible !== true || qa.scheduleVersionReady !== true) throw new Error('Dentistry course-4 QA is not ScheduleVersion-ready');
  if (!Array.isArray(qa.checks) || qa.checks.some((check) => check?.status !== 'PASS')) throw new Error('QA must contain only PASS checks before publication');
  if (!Array.isArray(qa.blockers) || qa.blockers.length !== 0) throw new Error('QA blockers must be empty before publication');
  if (!Array.isArray(draft.events)) throw new Error('normalized draft events must be an array');

  const events = draft.events;
  const candidateDigest = assertNonEmptyString(draft.candidateDigest, 'draft.candidateDigest');
  if (candidateDigest !== CANDIDATE_DIGEST || candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) throw new Error(`Dentistry course-4 approved artifact digest mismatch: ${candidateDigest}`);
  const normalizedEventSetDigest = digestNormalizedEvents(events);
  if (normalizedEventSetDigest !== publication.eventSetDigest || normalizedEventSetDigest !== CANDIDATE_DIGEST) throw new Error(`Dentistry course-4 event-set digest mismatch: ${normalizedEventSetDigest}`);
  if (events.length !== 531 || events.length !== draft.eventCount || events.length !== publication.eventCount) throw new Error(`Dentistry course-4 event count mismatch: ${events.length}`);
  if (new Set(events.map((event) => event.eventId)).size !== events.length) throw new Error('Dentistry course-4 duplicate eventId detected');
  if (events.some((event) => !['floating', 'date-only'].includes(event.timeSemantics))) throw new Error('Dentistry course-4 contains unsupported time semantics');
  if (events.some((event) => event.timeSemantics === 'date-only' && (Object.hasOwn(event, 'startTime') || Object.hasOwn(event, 'endTime')))) throw new Error('Dentistry course-4 date-only events must not contain startTime or endTime');
  if (events.filter((event) => event.timeSemantics === 'date-only').length !== 48) throw new Error('Dentistry course-4 must contain exactly 48 date-only Practice events');

  if (JSON.stringify(sourceArtifact.expectedGroupIds) !== JSON.stringify(GROUPS) || JSON.stringify(parsingJob.expectedGroupIds) !== JSON.stringify(GROUPS)) throw new Error('unexpected Dentistry course-4 group scope');
  const actualCounts = countByGroup(events);
  for (const groupId of GROUPS) {
    if (actualCounts[groupId] !== EXPECTED_COUNTS[groupId] || actualCounts[groupId] !== publication.groupEventCounts?.[groupId]) throw new Error(`group ${groupId} event count evidence mismatch`);
    const groupEvents = events.filter((event) => event.groupId === groupId);
    const dateOnlyCount = groupEvents.filter((event) => event.timeSemantics === 'date-only').length;
    if (dateOnlyCount !== EXPECTED_DATE_ONLY_COUNTS[groupId] || dateOnlyCount !== publication.groupDateOnlyEventCounts?.[groupId]) throw new Error(`group ${groupId} date-only event count evidence mismatch`);
    if (publication.groupDefaultVisibleEventCounts?.[groupId] !== EXPECTED_COUNTS[groupId]) throw new Error(`group ${groupId} default-visible count evidence mismatch`);
    if (publication.groupFacultativeEventCounts?.[groupId] !== 0) throw new Error(`group ${groupId} facultative count must be zero`);
  }
  if (Object.keys(actualCounts).length !== GROUPS.length) throw new Error('candidate contains unexpected groups');
  if (!Array.isArray(publication.facultativeIds) || publication.facultativeIds.length !== 0) throw new Error('Dentistry course-4 publication evidence must not contain facultative IDs');

  const versions = GROUPS.map((groupId) => ({
    groupId,
    versionId: stableVersionId({ academicPeriodId: ACADEMIC_PERIOD_ID, programId: PROGRAM_ID, groupId, candidateDigest }),
    eventCount: actualCounts[groupId]
  }));

  return {
    plan: {
      universityId: UNIVERSITY_ID,
      programId: PROGRAM_ID,
      academicYearId: ACADEMIC_YEAR_ID,
      academicPeriodId: ACADEMIC_PERIOD_ID,
      sourceId: sourceArtifact.sourceId,
      sourceSha256: SOURCE_SHA256,
      candidateDigest,
      eventSetDigest: normalizedEventSetDigest,
      coreEvidence: publication.sharedContractEvidence,
      events,
      versions,
      publication,
      parsingResult: {
        jobId: parsingJob.jobId,
        universityId: UNIVERSITY_ID,
        academicPeriodId: ACADEMIC_PERIOD_ID,
        events
      }
    },
    qaForPublication: {
      qaReportId: `qa-dentistry-491-494-${SOURCE_SHA256.slice(0, 16)}-v1`,
      parsingJobId: parsingJob.jobId,
      candidateDigest,
      decision: 'pass',
      checks: coreQaChecks(qa),
      createdAt: publication.createdAt
    }
  };
}

function verifyCourse4DatabaseState({ database, phase }) {
  const fkErrors = database.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length !== 0) {
    const stage = phase === 'after-publication' ? 'after' : 'before';
    throw new Error(`SQLite foreign_key_check failed ${stage} publication: ${fkErrors.length}`);
  }
}

function verifyCourse4Ics({ core, published, version, plan, unfoldIcs, countVevents }) {
  const defaultIcs = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ стоматология ${version.groupId}`
  }));
  if (countVevents(defaultIcs) !== version.eventCount) {
    throw new Error(`group ${version.groupId} default ICS count verification failed`);
  }
  const dateOnlyCount = (defaultIcs.match(/DTSTART;VALUE=DATE:\d{8}/g) ?? []).length;
  if (dateOnlyCount !== plan.publication.groupDateOnlyEventCounts[version.groupId]) {
    throw new Error(`group ${version.groupId} all-day ICS count verification failed`);
  }
  if (!defaultIcs.includes('DTSTART;VALUE=DATE:20270118')) {
    throw new Error(`group ${version.groupId} Practice start date is missing from ICS`);
  }
  if (published.events.some((event) => event.assessment) && !defaultIcs.includes('DESCRIPTION:')) {
    throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }
}

const { plan, qaForPublication } = await loadPlan();
await runDentistryPublication({
  apply: APPLY,
  plan,
  qaForPublication,
  result: 'PRODUCTION_DENTISTRY_COURSE_4_SCHEDULES_PUBLISHED_AND_VERIFIED',
  verifyDatabaseState: verifyCourse4DatabaseState,
  verifyPublishedIcs: verifyCourse4Ics,
  preflightMetadata: {
    dateOnlyEventCount: plan.events.filter((event) => event.timeSemantics === 'date-only').length
  },
  resultMetadata: {
    dateOnlyEventCount: 48
  }
});
