#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../../src/explicit-decisions.js';
import { toCorePublicationQa } from '../../src/medicine-publication-plan.js';
import { applyMedicinePublicationPlan } from './publish-medicine-plan.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

function normalizeEvidence(evidence) {
  return {
    sourceSha256: evidence.sourceSha256 ?? evidence.source?.sha256,
    candidateDigest: evidence.candidateDigest ?? evidence.candidate?.candidateDigest,
    eventCount: evidence.eventCount ?? evidence.candidate?.eventCount,
    groupEventCounts: evidence.groupEventCounts ?? evidence.candidate?.groupEventCounts
  };
}

function validateConfig({
  scope,
  groups,
  approvedSourceSha256,
  approvedCandidateDigest,
  approvedEventCount,
  expectedGroupEventCounts
}) {
  if (typeof scope !== 'string' || scope.length === 0) throw new TypeError('scope is required');
  if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('groups must be a non-empty array');
  if (typeof approvedSourceSha256 !== 'string' || approvedSourceSha256.length === 0) {
    throw new TypeError('approvedSourceSha256 is required');
  }
  if (typeof approvedCandidateDigest !== 'string' || approvedCandidateDigest.length === 0) {
    throw new TypeError('approvedCandidateDigest is required');
  }
  if (!Number.isInteger(approvedEventCount) || approvedEventCount <= 0) {
    throw new TypeError('approvedEventCount must be a positive integer');
  }
  if (!expectedGroupEventCounts || typeof expectedGroupEventCounts !== 'object' || Array.isArray(expectedGroupEventCounts)) {
    throw new TypeError('expectedGroupEventCounts must be an object');
  }
  for (const groupId of groups) {
    if (!Number.isInteger(expectedGroupEventCounts[groupId]) || expectedGroupEventCounts[groupId] <= 0) {
      throw new TypeError(`expectedGroupEventCounts.${groupId} must be a positive integer`);
    }
  }
}

export async function runExplicitMedicineCoursePublication({
  scope,
  groups,
  approvedSourceSha256,
  approvedCandidateDigest,
  approvedEventCount,
  expectedGroupEventCounts,
  includeGroupEventCountsInSummary = false,
  compatibleRendererBlobs = [],
  reportRendererCompatibility = false,
  verifyPublishedIcs,
  formatIcsVerificationLog,
  finalResultFields = {}
}) {
  validateConfig({
    scope,
    groups,
    approvedSourceSha256,
    approvedCandidateDigest,
    approvedEventCount,
    expectedGroupEventCounts
  });

  const apply = process.argv.includes('--apply');
  const unknownArgs = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
  if (unknownArgs.length > 0) throw new Error(`unsupported arguments: ${unknownArgs.join(', ')}`);

  const [manifest, source, evidence, qa] = await Promise.all([
    readJson(`fixtures/2026-2027-semester-1/medicine-${scope}.decisions.json`),
    readJson(`fixtures/2026-2027-semester-1/medicine-${scope}.source.json`),
    readJson(`qa/2026-2027-semester-1/medicine-${scope}.evidence.json`),
    readJson(`qa/2026-2027-semester-1/medicine-${scope}.qa-report.json`)
  ]);
  const normalizedEvidence = normalizeEvidence(evidence);

  if (source.source?.sha256 !== approvedSourceSha256 || manifest.sourceSha256 !== approvedSourceSha256) {
    throw new Error(`medicine ${scope} official source SHA-256 does not match approved source`);
  }
  if (qa.decision !== 'pass' || qa.candidateDigest !== approvedCandidateDigest) {
    throw new Error(`medicine ${scope} QA gate does not match approved PASS candidate`);
  }
  if (qa.checks?.some((check) => check?.status === 'fail')) {
    throw new Error(`medicine ${scope} QA contains a failing check`);
  }
  if (normalizedEvidence.sourceSha256 !== approvedSourceSha256) {
    throw new Error(`medicine ${scope} evidence source SHA-256 mismatch`);
  }
  if (normalizedEvidence.candidateDigest !== approvedCandidateDigest) {
    throw new Error(`medicine ${scope} evidence candidate digest mismatch`);
  }
  if (normalizedEvidence.eventCount !== approvedEventCount) {
    throw new Error(`medicine ${scope} evidence event count mismatch`);
  }
  if (JSON.stringify(source.expectedGroupIds) !== JSON.stringify(groups) || JSON.stringify(manifest.groupTable) !== JSON.stringify(groups)) {
    throw new Error(`medicine ${scope} group scope must be exactly ${scope}`);
  }

  const events = expandExplicitDecisionManifest(manifest, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });
  const candidateDigest = digestNormalizedEvents(events);
  if (candidateDigest !== approvedCandidateDigest) {
    throw new Error(`expanded medicine ${scope} candidate digest mismatch: ${candidateDigest}`);
  }
  if (events.length !== approvedEventCount) {
    throw new Error(`expanded medicine ${scope} event count mismatch: ${events.length}`);
  }

  const groupEventCounts = Object.fromEntries(groups.map((groupId) => [
    groupId,
    events.filter((event) => event.groupId === groupId).length
  ]));
  for (const groupId of groups) {
    const expectedCount = expectedGroupEventCounts[groupId];
    const evidenceCount = normalizedEvidence.groupEventCounts?.[groupId];
    if (groupEventCounts[groupId] !== expectedCount || evidenceCount !== expectedCount) {
      throw new Error(`group ${groupId} must contain exactly ${expectedCount} approved events`);
    }
  }

  const versionSuffix = approvedCandidateDigest.replace('sha256:', '').slice(0, 16);
  const versions = groups.map((groupId) => ({
    groupId,
    versionId: `kgmu-2026-2027-s1-medicine-${groupId}-${versionSuffix}`,
    eventCount: expectedGroupEventCounts[groupId]
  }));
  const parsingResult = {
    jobId: qa.parsingJobId,
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    events
  };

  const summary = {
    mode: apply ? 'apply' : 'preflight',
    universityId: source.universityId,
    academicYearId: source.academicYear,
    academicPeriodId: source.academicPeriodId,
    groups,
    sourceSha256: approvedSourceSha256,
    candidateDigest: approvedCandidateDigest,
    versionSuffix,
    groupCount: groups.length,
    eventCount: events.length
  };
  if (includeGroupEventCountsInSummary) summary.groupEventCounts = groupEventCounts;
  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    console.log('PREFLIGHT_OK_NO_DATABASE_CHANGES');
    return;
  }

  await applyMedicinePublicationPlan({
    plan: {
      universityId: source.universityId,
      academicYearId: source.academicYear,
      academicPeriodId: source.academicPeriodId,
      candidateDigest: approvedCandidateDigest,
      events,
      versions,
      parsingResult
    },
    qaForPublication: toCorePublicationQa(qa),
    coreEvidence: qa.sharedContractEvidence,
    compatibleRendererBlobs,
    reportRendererCompatibility,
    verifyForeignKeys: true,
    verifyPublishedIcs,
    formatIcsVerificationLog,
    resultFields: {
      candidateDigest: approvedCandidateDigest,
      ...finalResultFields,
      landingChanged: false
    }
  });
}
