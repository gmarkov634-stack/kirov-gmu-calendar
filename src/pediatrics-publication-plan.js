import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest,
  sha256Hex
} from './explicit-decisions.js';
import { finalizePublicationPlan } from './publication-plan-foundation.js';
export { toCorePublicationQa } from './publication-plan-foundation.js';

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

function compareEvents(a, b) {
  return [
    Number(a.groupId) - Number(b.groupId),
    a.date.localeCompare(b.date),
    a.startTime.localeCompare(b.startTime),
    a.endTime.localeCompare(b.endTime),
    a.discipline.localeCompare(b.discipline),
    a.lessonType.localeCompare(b.lessonType),
    a.sourceRef.locator.localeCompare(b.sourceRef.locator)
  ].find((value) => value !== 0) ?? 0;
}

function stableVersionId({ academicPeriodId, groupId, candidateDigest }) {
  const match = academicPeriodId.match(/^\d{4}-\d{4}-semester-(\d+)$/);
  if (!match) throw new Error(`unsupported academicPeriodId for stable version id: ${academicPeriodId}`);
  const digest = assertNonEmptyString(candidateDigest, 'candidateDigest').replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/i.test(digest)) throw new TypeError('candidateDigest must be a SHA-256 digest');
  return `kgmu-2026-2027-s${match[1]}-pediatrics-${groupId}-${digest.slice(0, 16)}`;
}

export function expandPediatricsFacultativeFixture(facultatives, context) {
  assertObject(facultatives, 'facultatives');
  assertObject(context, 'context');
  if (facultatives.schema !== 'kgmu-pediatrics-facultatives-v1') {
    throw new Error(`unsupported facultative fixture schema: ${facultatives.schema}`);
  }
  if (facultatives.semanticDecisionMode !== 'operator-confirmed-r90') {
    throw new Error('facultative fixture requires operator-confirmed-r90 semantics');
  }
  if (facultatives.defaultSelected !== false) {
    throw new Error('facultatives must default to not selected');
  }

  const universityId = assertNonEmptyString(context.universityId, 'context.universityId');
  const academicPeriodId = assertNonEmptyString(context.academicPeriodId, 'context.academicPeriodId');
  const sourceId = assertNonEmptyString(context.sourceId, 'context.sourceId');
  if (facultatives.academicPeriodId !== academicPeriodId) {
    throw new Error('facultative academicPeriodId mismatch');
  }
  if (!Array.isArray(facultatives.groupIds) || facultatives.groupIds.length === 0) {
    throw new TypeError('facultatives.groupIds must be a non-empty array');
  }
  if (!Array.isArray(facultatives.items) || facultatives.items.length === 0) {
    throw new TypeError('facultatives.items must be a non-empty array');
  }

  const seenIds = new Set();
  const events = [];
  for (const [itemIndex, item] of facultatives.items.entries()) {
    assertObject(item, `facultatives.items[${itemIndex}]`);
    const facultativeId = assertNonEmptyString(item.facultativeId, `facultatives.items[${itemIndex}].facultativeId`);
    if (seenIds.has(facultativeId)) throw new Error(`duplicate facultativeId: ${facultativeId}`);
    seenIds.add(facultativeId);
    const discipline = assertNonEmptyString(item.discipline, `facultatives.items[${itemIndex}].discipline`);
    const startTime = assertNonEmptyString(item.startTime, `facultatives.items[${itemIndex}].startTime`);
    const endTime = assertNonEmptyString(item.endTime, `facultatives.items[${itemIndex}].endTime`);
    if (!Number.isInteger(item.weekday) || item.weekday < 1 || item.weekday > 7) {
      throw new TypeError(`facultatives.items[${itemIndex}].weekday must be 1..7`);
    }
    if (!Array.isArray(item.dates) || item.dates.length === 0) {
      throw new TypeError(`facultatives.items[${itemIndex}].dates must be a non-empty array`);
    }

    for (const date of item.dates) {
      assertNonEmptyString(date, `facultatives.items[${itemIndex}].date`);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
      if (weekday !== item.weekday) {
        throw new Error(`${facultativeId} date ${date} does not match weekday ${item.weekday}`);
      }
      for (const groupId of facultatives.groupIds) {
        assertNonEmptyString(groupId, 'facultatives.groupId');
        const sourceLocator = `${facultatives.sheetName}!${facultatives.sourceLocator}#${facultativeId}`;
        const eventKey = [groupId, date, startTime, endTime, discipline, 'other', sourceLocator, facultativeId].join('|');
        const event = {
          eventId: `kgmu-${sha256Hex(eventKey).slice(0, 24)}`,
          universityId,
          groupId,
          academicPeriodId,
          date,
          startTime,
          endTime,
          timeSemantics: 'floating',
          discipline,
          lessonType: 'other',
          teacher: null,
          location: item.location ?? null,
          facultativeId,
          sourceRef: { sourceId, locator: sourceLocator }
        };
        if (item.assessment != null) event.assessment = structuredClone(item.assessment);
        events.push(event);
      }
    }
  }
  return events.sort(compareEvents);
}

export function buildPediatricsPublicationPlan({ manifest, facultatives, source, evidence, qa }) {
  assertObject(manifest, 'manifest');
  assertObject(facultatives, 'facultatives');
  assertObject(source, 'source');
  assertObject(evidence, 'evidence');
  assertObject(qa, 'qa');
  assertObject(source.source, 'source.source');

  const universityId = assertNonEmptyString(source.universityId, 'source.universityId');
  const programId = assertNonEmptyString(source.programId, 'source.programId');
  const academicPeriodId = assertNonEmptyString(source.academicPeriodId, 'source.academicPeriodId');
  const sourceId = assertNonEmptyString(source.source.sourceId, 'source.source.sourceId');
  const sourceSha256 = assertNonEmptyString(source.source.sha256, 'source.source.sha256');
  if (programId !== 'pediatrics') throw new Error(`unexpected programId: ${programId}`);

  if (manifest.sourceSha256 !== sourceSha256) throw new Error('manifest/source SHA-256 mismatch');
  if (facultatives.sourceSha256 !== sourceSha256) throw new Error('facultatives/source SHA-256 mismatch');
  if (evidence.sourceSha256 !== sourceSha256) throw new Error('evidence/source SHA-256 mismatch');
  if (manifest.parserRulesVersion !== source.parserRulesVersion) throw new Error('manifest/source parserRulesVersion mismatch');
  if (evidence.parserRulesVersion !== source.parserRulesVersion) throw new Error('evidence/source parserRulesVersion mismatch');
  const candidateDigest = assertNonEmptyString(qa.candidateDigest, 'qa.candidateDigest');
  if (evidence.candidateDigest !== candidateDigest) throw new Error('evidence/QA candidate digest mismatch');

  if (!Array.isArray(source.expectedGroupIds) || source.expectedGroupIds.length === 0) {
    throw new TypeError('source.expectedGroupIds must be a non-empty array');
  }
  if (JSON.stringify(manifest.groupTable) !== JSON.stringify(source.expectedGroupIds)) {
    throw new Error('manifest groupTable does not match source expectedGroupIds');
  }
  if (JSON.stringify(facultatives.groupIds) !== JSON.stringify(source.expectedGroupIds)) {
    throw new Error('facultative groupIds do not match source expectedGroupIds');
  }

  const baseEvents = expandExplicitDecisionManifest(manifest, {
    universityId,
    academicPeriodId,
    sourceId
  });
  const baseDigest = digestNormalizedEvents(baseEvents);
  if (baseDigest !== manifest.candidateDigest) {
    throw new Error(`base manifest events do not match manifest candidate digest: actual ${baseDigest}`);
  }
  if (evidence.baseCandidateDigest !== baseDigest) {
    throw new Error('evidence/base manifest candidate digest mismatch');
  }

  const facultativeEvents = expandPediatricsFacultativeFixture(facultatives, {
    universityId,
    academicPeriodId,
    sourceId
  });
  const events = [...baseEvents, ...facultativeEvents].sort(compareEvents);

  return finalizePublicationPlan({
    source,
    evidence,
    qa,
    events,
    additionalFields: { programId },
    versionIdFactory: ({ groupId, candidateDigest }) => stableVersionId({
      academicPeriodId,
      groupId,
      candidateDigest
    })
  });
}
