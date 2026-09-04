import { digestNormalizedEvents } from './explicit-decisions.js';

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

function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function countByGroup(events) {
  const counts = {};
  for (const event of events) counts[event.groupId] = (counts[event.groupId] ?? 0) + 1;
  return counts;
}

export function toCorePublicationQa(qa, { createdAt = qa?.createdAt } = {}) {
  assertObject(qa, 'qa');
  return Object.freeze({
    qaReportId: assertNonEmptyString(qa.qaReportId, 'qa.qaReportId'),
    parsingJobId: assertNonEmptyString(qa.parsingJobId, 'qa.parsingJobId'),
    candidateDigest: assertNonEmptyString(qa.candidateDigest, 'qa.candidateDigest'),
    decision: qa.decision,
    checks: qa.checks,
    createdAt: assertNonEmptyString(createdAt, 'createdAt')
  });
}

export function finalizePublicationPlan({
  source,
  evidence,
  qa,
  events,
  versionIdFactory,
  coreEvidence = qa?.sharedContractEvidence,
  additionalFields = {}
} = {}) {
  assertObject(source, 'source');
  assertObject(source.source, 'source.source');
  assertObject(evidence, 'evidence');
  assertObject(qa, 'qa');
  assertObject(additionalFields, 'additionalFields');
  assertFunction(versionIdFactory, 'versionIdFactory');
  if (!Array.isArray(events)) throw new TypeError('events must be an array');

  const universityId = assertNonEmptyString(source.universityId, 'source.universityId');
  const academicYearId = assertNonEmptyString(source.academicYear, 'source.academicYear');
  const academicPeriodId = assertNonEmptyString(source.academicPeriodId, 'source.academicPeriodId');
  const sourceId = assertNonEmptyString(source.source.sourceId, 'source.source.sourceId');
  const sourceSha256 = assertNonEmptyString(source.source.sha256, 'source.source.sha256');
  const candidateDigest = assertNonEmptyString(qa.candidateDigest, 'qa.candidateDigest');
  const qaReportId = assertNonEmptyString(qa.qaReportId, 'qa.qaReportId');
  const parsingJobId = assertNonEmptyString(qa.parsingJobId, 'qa.parsingJobId');

  if (qa.decision !== 'pass') throw new Error('QA decision must be pass before publication planning');
  if (!Array.isArray(qa.checks) || qa.checks.some((check) => check?.status === 'fail')) {
    throw new Error('QA checks must contain no fail status before publication planning');
  }
  if (evidence.candidateDigest !== candidateDigest) throw new Error('evidence/QA candidate digest mismatch');
  if (!Array.isArray(source.expectedGroupIds) || source.expectedGroupIds.length === 0) {
    throw new TypeError('source.expectedGroupIds must be a non-empty array');
  }
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

  const versionIds = new Set();
  const versions = source.expectedGroupIds.map((groupId) => {
    const versionId = assertNonEmptyString(
      versionIdFactory({
        source,
        groupId,
        candidateDigest,
        eventCount: actualCounts[groupId]
      }),
      `versionId for group ${groupId}`
    );
    if (versionIds.has(versionId)) throw new Error(`duplicate versionId: ${versionId}`);
    versionIds.add(versionId);
    return Object.freeze({ groupId, versionId, eventCount: actualCounts[groupId] });
  });

  const frozenEvents = Object.freeze([...events]);
  return Object.freeze({
    universityId,
    academicYearId,
    academicPeriodId,
    sourceId,
    sourceSha256,
    candidateDigest,
    qaReportId,
    parsingJobId,
    coreEvidence: Object.freeze({ ...assertObject(coreEvidence, 'coreEvidence') }),
    ...additionalFields,
    events: frozenEvents,
    versions: Object.freeze(versions),
    parsingResult: Object.freeze({
      jobId: parsingJobId,
      universityId,
      academicPeriodId,
      events: frozenEvents
    })
  });
}
