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

const EXPECTED_DIGEST = 'sha256:d2e3987a60ea05fc97de83afba9993285022dd932fd16a082da155efe589567f';
const GROUPS = ['631', '632', '633', '634', '635', '636', '637'];

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
  const semester = academicPeriodId.match(/^\d{4}-\d{4}-semester-(\d+)$/)?.[1];
  if (!semester) throw new Error(`unsupported academicPeriodId: ${academicPeriodId}`);
  const digest = assertNonEmptyString(candidateDigest, 'candidateDigest').replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/i.test(digest)) throw new TypeError('candidateDigest must be a SHA-256 digest');
  return `kgmu-2026-2027-s${semester}-${programId}-${groupId}-${digest.slice(0, 16)}`;
}

function countMatches(value, regex) {
  return (value.match(regex) ?? []).length;
}

async function loadPlan() {
  const [source, decisions, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.source.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-631-637.decisions.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-631-637.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-631-637.publication-evidence.json')
  ]);

  if (source.universityId !== 'kirov-gmu' || source.programId !== 'pediatrics' || source.course !== 6) {
    throw new Error('unexpected Pediatrics course-6 source identity');
  }
  if (source.academicYear !== '2026-2027' || source.academicPeriodId !== '2026-2027-semester-1') {
    throw new Error('unexpected academic period');
  }
  if (JSON.stringify(source.expectedGroupIds) !== JSON.stringify(GROUPS)) throw new Error('course-6 group table mismatch');
  const sourceSha256 = assertNonEmptyString(source.source?.sha256, 'source.source.sha256');
  if (sourceSha256 !== decisions.sourceSha256 || sourceSha256 !== publication.sourceSha256) {
    throw new Error('course-6 source SHA-256 evidence mismatch');
  }
  if (decisions.parserRulesVersion !== source.parserRulesVersion) throw new Error('course-6 parser rules evidence mismatch');
  if (qa.decision !== 'pass' || !Array.isArray(qa.checks) || qa.checks.some((check) => check?.status !== 'pass')) {
    throw new Error('QA decision must be pass with all checks passing before publication');
  }

  const events = expandExplicitDecisionManifest(decisions, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const candidateDigest = digestNormalizedEvents(events);
  if (candidateDigest !== EXPECTED_DIGEST || candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) {
    throw new Error(`course-6 candidate digest mismatch: ${candidateDigest}`);
  }
  if (events.length !== 679 || events.length !== publication.eventCount) throw new Error(`course-6 event count mismatch: ${events.length}`);
  if (new Set(events.map((event) => event.eventId)).size !== events.length) throw new Error('course-6 duplicate eventId detected');

  const floating = events.filter((event) => event.timeSemantics === 'floating');
  const dateOnly = events.filter((event) => event.timeSemantics === 'date-only');
  if (floating.length !== 637 || dateOnly.length !== 42) throw new Error('course-6 timing-semantics cardinality mismatch');
  if (publication.timeSemanticsCounts?.floating !== 637 || publication.timeSemanticsCounts?.['date-only'] !== 42) {
    throw new Error('course-6 timing-semantics publication evidence mismatch');
  }
  if (dateOnly.some((event) => Object.hasOwn(event, 'startTime') || Object.hasOwn(event, 'endTime'))) {
    throw new Error('course-6 date-only candidate contains invented clock time');
  }
  if (dateOnly.some((event) => event.location != null)) throw new Error('course-6 date-only candidate contains invented location');

  const actualCounts = countByGroup(events);
  for (const groupId of GROUPS) {
    if (actualCounts[groupId] !== 97 || publication.groupEventCounts?.[groupId] !== 97) {
      throw new Error(`group ${groupId} event count evidence mismatch`);
    }
    const allDayCount = dateOnly.filter((event) => event.groupId === groupId).length;
    if (allDayCount !== 6 || publication.groupDateOnlyCounts?.[groupId] !== 6) {
      throw new Error(`group ${groupId} date-only count evidence mismatch`);
    }
  }
  if (Object.keys(actualCounts).length !== GROUPS.length) throw new Error('candidate contains unexpected groups');

  const versions = GROUPS.map((groupId) => ({
    groupId,
    versionId: stableVersionId({
      academicPeriodId: source.academicPeriodId,
      programId: source.programId,
      groupId,
      candidateDigest
    }),
    eventCount: 97,
    dateOnlyCount: 6
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
        jobId: qa.parsingJobId,
        universityId: source.universityId,
        academicPeriodId: source.academicPeriodId,
        events
      }
    },
    qaForPublication: {
      qaReportId: qa.qaReportId,
      parsingJobId: qa.parsingJobId,
      candidateDigest,
      decision: 'pass',
      checks: qa.checks,
      createdAt: qa.createdAt
    }
  };
}

function validateCourse6CoreEvidence(evidence) {
  if (evidence.commit !== evidence.productionRuntimeCommit) {
    throw new Error('course-6 core evidence commit/runtime mismatch');
  }
}

function verifyCourse6DatabaseState({ database, phase }) {
  if (database.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    const prefix = phase === 'after-publication' ? 'post-publication ' : '';
    throw new Error(`${prefix}SQLite foreign_key_check failed`);
  }
  if (phase === 'before-publication') {
    const migration = database.prepare(
      "SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id='008_date_only_event_timing'"
    ).get()?.count;
    if (Number(migration) !== 1) throw new Error('date-only migration 008 is not active');
  }
}

function verifyCourse6Ics({ core, published, version, unfoldIcs }) {
  if (published.events.filter((event) => event.timeSemantics === 'date-only').length !== version.dateOnlyCount) {
    throw new Error(`group ${version.groupId} final date-only count verification failed`);
  }

  const ics = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ педиатрия ${version.groupId}`,
    preferences: { remindersMinutesBefore: [15] }
  }));
  if (countMatches(ics, /BEGIN:VEVENT/g) !== version.eventCount) {
    throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
  }
  if (countMatches(ics, /DTSTART;VALUE=DATE:\d{8}/g) !== version.dateOnlyCount ||
      countMatches(ics, /DTEND;VALUE=DATE:\d{8}/g) !== version.dateOnlyCount) {
    throw new Error(`group ${version.groupId} ICS all-day timing verification failed`);
  }
  const timedCount = version.eventCount - version.dateOnlyCount;
  if (countMatches(ics, /DTSTART:\d{8}T\d{6}/g) !== timedCount) {
    throw new Error(`group ${version.groupId} ICS floating timing verification failed`);
  }
  if (countMatches(ics, /BEGIN:VALARM/g) !== timedCount) {
    throw new Error(`group ${version.groupId} ICS reminder/date-only alarm boundary verification failed`);
  }
  for (const event of published.events.filter((item) => item.timeSemantics === 'date-only')) {
    const uid = `UID:${event.eventId}@medical-calendar`;
    if (!ics.includes(uid)) throw new Error(`group ${version.groupId} missing date-only UID ${event.eventId}`);
    const block = ics.split(uid)[1]?.split('END:VEVENT')[0] ?? '';
    if (/BEGIN:VALARM/.test(block) || /DTSTART[^\r\n]*T\d{6}/.test(block) || /DTEND[^\r\n]*T\d{6}/.test(block)) {
      throw new Error(`group ${version.groupId} date-only event ${event.eventId} acquired synthetic timing/alarm`);
    }
  }
}

const { plan, qaForPublication } = await loadPlan();
await runPediatricsPublication({
  apply: APPLY,
  plan,
  qaForPublication,
  result: 'PRODUCTION_PEDIATRICS_COURSE_6_SCHEDULES_PUBLISHED_AND_VERIFIED',
  validateCoreEvidence: validateCourse6CoreEvidence,
  verifyDatabaseState: verifyCourse6DatabaseState,
  verifyPublishedIcs: verifyCourse6Ics,
  preflightMetadata: {
    floatingEventCount: 637,
    dateOnlyEventCount: 42
  },
  resultMetadata: {
    floatingEventCount: 637,
    dateOnlyEventCount: 42
  }
});
