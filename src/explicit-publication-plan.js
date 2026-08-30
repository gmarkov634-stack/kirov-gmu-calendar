import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from './explicit-decisions.js';

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
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

export function buildExplicitPublicationPlan({ manifest, source, evidence, qa }) {
  assertObject(manifest, 'manifest');
  assertObject(source, 'source');
  assertObject(evidence, 'evidence');
  assertObject(qa, 'qa');
  assertObject(source.source, 'source.source');

  const universityId = assertNonEmptyString(source.universityId, 'source.universityId');
  const programId = assertNonEmptyString(source.programId, 'source.programId');
  const academicYearId = assertNonEmptyString(source.academicYear, 'source.academicYear');
  const academicPeriodId = assertNonEmptyString(source.academicPeriodId, 'source.academicPeriodId');
  const sourceId = assertNonEmptyString(source.source.sourceId, 'source.source.sourceId');
  const sourceSha256 = assertNonEmptyString(source.source.sha256, 'source.source.sha256');

  if (manifest.sourceSha256 !== sourceSha256) throw new Error('manifest/source SHA-256 mismatch');
  if (evidence.sourceSha256 !== sourceSha256) throw new Error('evidence/source SHA-256 mismatch');
  if (manifest.parserRulesVersion !== source.parserRulesVersion) throw new Error('manifest/source parserRulesVersion mismatch');
  if (evidence.parserRulesVersion !== source.parserRulesVersion) throw new Error('evidence/source parserRulesVersion mismatch');
  if (qa.decision !== 'pass') throw new Error('QA decision must be pass before publication planning');
  if (!Array.isArray(qa.checks) || qa.checks.some((check) => check?.status === 'fail')) {
    throw new Error('QA checks must contain no fail status before publication planning');
  }

  const candidateDigest = assertNonEmptyString(qa.candidateDigest, 'qa.candidateDigest');
  if (manifest.candidateDigest !== candidateDigest) throw new Error('manifest/QA candidate digest mismatch');
  if (evidence.candidateDigest !== candidateDigest) throw new Error('evidence/QA candidate digest mismatch');

  if (!Array.isArray(source.expectedGroupIds) || source.expectedGroupIds.length === 0) {
    throw new TypeError('source.expectedGroupIds must be a non-empty array');
  }
  if (JSON.stringify(manifest.groupTable) !== JSON.stringify(source.expectedGroupIds)) {
    throw new Error('manifest groupTable does not match source expectedGroupIds');
  }

  const events = expandExplicitDecisionManifest(manifest, {
    universityId,
    academicPeriodId,
    sourceId
  });
  if (events.length !== evidence.eventCount) throw new Error('expanded event count does not match evidence');
  const actualDigest = digestNormalizedEvents(events);
  if (actualDigest !== candidateDigest) {
    throw new Error(`expanded events do not match QA candidate digest: actual ${actualDigest}`);
  }

  const actualCounts = countByGroup(events);
  for (const groupId of source.expectedGroupIds) {
    if (actualCounts[groupId] !== evidence.groupEventCounts?.[groupId]) {
      throw new Error(`group ${groupId} event count does not match evidence`);
    }
  }
  if (Object.keys(actualCounts).length !== source.expectedGroupIds.length) {
    throw new Error('expanded events contain unexpected groups');
  }

  const versions = source.expectedGroupIds.map((groupId) => Object.freeze({
    groupId,
    versionId: stableVersionId({ academicPeriodId, programId, groupId, candidateDigest }),
    eventCount: actualCounts[groupId]
  }));

  return Object.freeze({
    universityId,
    programId,
    academicYearId,
    academicPeriodId,
    sourceId,
    sourceSha256,
    candidateDigest,
    qaReportId: assertNonEmptyString(qa.qaReportId, 'qa.qaReportId'),
    parsingJobId: assertNonEmptyString(qa.parsingJobId, 'qa.parsingJobId'),
    coreEvidence: Object.freeze({ ...assertObject(qa.sharedContractEvidence, 'qa.sharedContractEvidence') }),
    events: Object.freeze(events),
    versions: Object.freeze(versions),
    parsingResult: Object.freeze({
      jobId: qa.parsingJobId,
      universityId,
      academicPeriodId,
      events: Object.freeze(events)
    })
  });
}
