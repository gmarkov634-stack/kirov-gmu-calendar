#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestNormalizedEvents } from '../src/explicit-decisions.js';
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
  const [source, draft, qa, publication] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-531-537.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-531-537.normalized-draft.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-531-537.qa-report.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-531-537.publication-evidence.json')
  ]);

  if (source.universityId !== 'kirov-gmu' || source.programId !== 'pediatrics' || source.course !== 5) {
    throw new Error('unexpected Pediatrics course-5 source identity');
  }
  if (source.academicYear !== '2026-2027' || source.academicPeriodId !== '2026-2027-semester-1') throw new Error('unexpected academic period');
  const sourceSha256 = assertNonEmptyString(source.source?.sha256, 'source.source.sha256');
  if (draft.sourceSha256 !== sourceSha256 || publication.sourceSha256 !== sourceSha256) throw new Error('course-5 source SHA-256 evidence mismatch');
  if (draft.sourceArtifactId !== source.source.sourceArtifactId || qa.sourceArtifactId !== source.source.sourceArtifactId) throw new Error('course-5 SourceArtifact evidence mismatch');
  if (draft.parserProfile !== source.parserProfile || draft.parserRulesVersion !== source.parserRulesVersion) throw new Error('course-5 parser evidence mismatch');
  if (draft.status !== 'PASS') throw new Error(`normalized draft status must be PASS, got ${draft.status}`);
  if (qa.decision !== 'pass' || !Array.isArray(qa.checks) || qa.checks.some((check) => check?.status === 'fail')) throw new Error('QA decision must be pass with no failing checks before publication');
  if (draft.parsingJobId !== qa.parsingJobId) throw new Error('normalized draft/QA parsingJobId mismatch');
  if (!Array.isArray(draft.events) || draft.events.length !== draft.eventCount) throw new Error('normalized draft eventCount mismatch');

  const events = draft.events;
  const candidateDigest = digestNormalizedEvents(events);
  if (candidateDigest !== draft.candidateDigest || candidateDigest !== qa.candidateDigest || candidateDigest !== publication.candidateDigest) {
    throw new Error(`course-5 candidate digest mismatch: ${candidateDigest}`);
  }
  if (events.length !== 910 || events.length !== publication.eventCount) throw new Error(`course-5 event count mismatch: ${events.length}`);
  if (JSON.stringify(draft.expectedGroupIds) !== JSON.stringify(source.expectedGroupIds)) throw new Error('course-5 group table mismatch');
  if (events.some((event) => event.timeSemantics !== 'floating')) throw new Error('course-5 publication candidate must contain floating events only');
  if (events.some((event) => event.facultativeId != null)) throw new Error('course-5 candidate unexpectedly contains facultative events');
  if (new Set(events.map((event) => event.eventId)).size !== events.length) throw new Error('course-5 duplicate eventId detected');

  const actualCounts = countByGroup(events);
  for (const groupId of source.expectedGroupIds) {
    if (actualCounts[groupId] !== 130 || publication.groupEventCounts?.[groupId] !== 130) throw new Error(`group ${groupId} event count evidence mismatch`);
  }
  if (Object.keys(actualCounts).length !== source.expectedGroupIds.length) throw new Error('candidate contains unexpected groups');

  const versions = source.expectedGroupIds.map((groupId) => ({
    groupId,
    versionId: stableVersionId({ academicPeriodId: source.academicPeriodId, programId: source.programId, groupId, candidateDigest }),
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

const { plan, qaForPublication } = await loadPlan();
await runPediatricsPublication({
  apply: APPLY,
  plan,
  qaForPublication,
  result: 'PRODUCTION_PEDIATRICS_COURSE_5_SCHEDULES_PUBLISHED_AND_VERIFIED'
});
