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
  const [source, draft, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/dentistry-191-194.source.json'),
    readJson('fixtures/2026-2027-semester-1/normalized/dentistry-191-194.normalized.json'),
    readJson('qa/2026-2027-semester-1/dentistry-191-194.qa-report.json'),
    readJson('qa/2026-2027-semester-1/dentistry-191-194.publication-evidence.json')
  ]);

  if (source.universityId !== 'kirov-gmu' || source.programId !== 'dentistry' || source.course !== 1) {
    throw new Error('unexpected Dentistry course-1 source identity');
  }
  if (source.academicYear !== '2026-2027' || source.academicPeriodId !== '2026-2027-semester-1') {
    throw new Error('unexpected academic period');
  }
  const sourceSha256 = assertNonEmptyString(source.source?.sha256, 'source.source.sha256');
  if (draft.sourceSha256 !== sourceSha256 || publication.sourceSha256 !== sourceSha256) {
    throw new Error('Dentistry course-1 source SHA-256 evidence mismatch');
  }
  if (draft.parserRulesVersion !== source.parserRulesVersion) {
    throw new Error('Dentistry course-1 parser evidence mismatch');
  }
  if (draft.status !== 'NORMALIZED') {
    throw new Error(`normalized draft status must be NORMALIZED, got ${draft.status}`);
  }
  if (qa.decision !== 'pass' || qa.readyForScheduleVersion !== true || qa.unresolvedSemanticItemCount !== 0) {
    throw new Error('Dentistry course-1 QA is not ScheduleVersion-ready');
  }
  if (!Array.isArray(qa.checks) || qa.checks.some((check) => check?.status === 'fail')) {
    throw new Error('QA decision must be pass with no failing checks before publication');
  }
  if (!Array.isArray(draft.events)) throw new Error('normalized draft events must be an array');

  const events = draft.events;
  const candidateDigest = assertNonEmptyString(draft.candidateDigest, 'draft.candidateDigest');
  if (candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) {
    throw new Error(`Dentistry course-1 approved artifact digest mismatch: ${candidateDigest}`);
  }
  const normalizedEventSetDigest = digestNormalizedEvents(events);
  if (normalizedEventSetDigest !== publication.eventSetDigest) {
    throw new Error(`Dentistry course-1 event-set digest mismatch: ${normalizedEventSetDigest}`);
  }
  if (events.length !== 1656 || events.length !== qa.eventCount || events.length !== publication.eventCount) {
    throw new Error(`Dentistry course-1 event count mismatch: ${events.length}`);
  }
  if (events.some((event) => event.timeSemantics !== 'floating')) {
    throw new Error('Dentistry course-1 publication candidate must contain floating events only');
  }
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error('Dentistry course-1 duplicate eventId detected');
  }

  const expectedGroups = source.expectedGroupIds;
  const actualCounts = countByGroup(events);
  const facultativeIds = new Set(publication.facultativeIds);
  if (facultativeIds.size !== publication.facultativeIds.length) {
    throw new Error('duplicate facultativeId in publication evidence');
  }
  const actualFacultativeIds = new Set(
    events.filter((event) => event.facultativeId != null).map((event) => event.facultativeId)
  );
  if (JSON.stringify([...actualFacultativeIds].sort()) !== JSON.stringify([...facultativeIds].sort())) {
    throw new Error('Dentistry course-1 facultative catalog does not match publication evidence');
  }

  for (const groupId of expectedGroups) {
    if (actualCounts[groupId] !== publication.groupEventCounts?.[groupId] || actualCounts[groupId] !== qa.eventCountByGroup?.[groupId]) {
      throw new Error(`group ${groupId} event count evidence mismatch`);
    }
    const groupEvents = events.filter((event) => event.groupId === groupId);
    const facultativeCount = groupEvents.filter((event) => event.facultativeId != null).length;
    const defaultVisibleCount = groupEvents.length - facultativeCount;
    if (facultativeCount !== publication.groupFacultativeEventCounts?.[groupId]) {
      throw new Error(`group ${groupId} facultative event count evidence mismatch`);
    }
    if (defaultVisibleCount !== publication.groupDefaultVisibleEventCounts?.[groupId]) {
      throw new Error(`group ${groupId} default-visible event count evidence mismatch`);
    }
  }
  if (Object.keys(actualCounts).length !== expectedGroups.length) throw new Error('candidate contains unexpected groups');

  const versions = expectedGroups.map((groupId) => ({
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
      eventSetDigest: normalizedEventSetDigest,
      coreEvidence: publication.sharedContractEvidence,
      events,
      versions,
      publication,
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
      createdAt: publication.createdAt
    }
  };
}

const { plan, qaForPublication } = await loadPlan();
await runDentistryPublication({
  apply: APPLY,
  plan,
  qaForPublication,
  result: 'PRODUCTION_DENTISTRY_COURSE_1_SCHEDULES_PUBLISHED_AND_VERIFIED'
});
