import { createHash } from 'node:crypto';

const DECISION_SCHEMA = 'kgmu-explicit-semantic-decisions-v3';
const SEMANTIC_MODE = 'operator-authored-explicit';
const HEX_MASK = /^[0-9a-f]+$/i;

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

function assertIndex(value, table, label) {
  if (!Number.isInteger(value) || value < 0 || value >= table.length) {
    throw new RangeError(`${label} is outside its table`);
  }
  return value;
}

function selectByMask(table, maskHex, label) {
  const value = assertNonEmptyString(maskHex, label);
  if (!HEX_MASK.test(value)) throw new TypeError(`${label} must be hexadecimal`);
  const mask = BigInt(`0x${value}`);
  if (mask === 0n) throw new RangeError(`${label} must select at least one item`);
  const selected = table.filter((_, index) => (mask & (1n << BigInt(index))) !== 0n);
  if (selected.length === 0) throw new RangeError(`${label} selects no known items`);
  if ((mask >> BigInt(table.length)) !== 0n) {
    throw new RangeError(`${label} selects indexes outside its table`);
  }
  return selected;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function digestNormalizedEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  return `sha256:${sha256Hex(canonicalJson(events))}`;
}

export function expandExplicitDecisionManifest(manifest, context) {
  assertObject(manifest, 'manifest');
  assertObject(context, 'context');
  if (manifest.schema !== DECISION_SCHEMA) {
    throw new Error(`unsupported explicit decision schema: ${manifest.schema}`);
  }
  if (manifest.semanticDecisionMode !== SEMANTIC_MODE) {
    throw new Error(`unsupported semantic decision mode: ${manifest.semanticDecisionMode}`);
  }

  const universityId = assertNonEmptyString(context.universityId, 'context.universityId');
  const academicPeriodId = assertNonEmptyString(context.academicPeriodId, 'context.academicPeriodId');
  const sourceId = assertNonEmptyString(context.sourceId, 'context.sourceId');

  for (const [label, table] of [
    ['manifest.groupTable', manifest.groupTable],
    ['manifest.dateTable', manifest.dateTable],
    ['manifest.disciplineTable', manifest.disciplineTable],
    ['manifest.lessonTypeTable', manifest.lessonTypeTable],
    ['manifest.locationTable', manifest.locationTable]
  ]) {
    if (!Array.isArray(table) || table.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  }
  if (!Array.isArray(manifest.decisions)) throw new TypeError('manifest.decisions must be an array');
  if (manifest.decisionCount !== manifest.decisions.length) {
    throw new Error('manifest.decisionCount does not match decisions length');
  }
  if (!Number.isInteger(manifest.logicalSourceCellCount) || manifest.logicalSourceCellCount <= 0) {
    throw new TypeError('manifest.logicalSourceCellCount must be a positive integer');
  }

  const events = [];
  for (const [decisionIndex, tuple] of manifest.decisions.entries()) {
    if (!Array.isArray(tuple) || tuple.length !== 8) {
      throw new TypeError(`manifest.decisions[${decisionIndex}] must contain exactly 8 fields`);
    }
    const [
      locator,
      groupMaskHex,
      dateMaskHex,
      startTime,
      endTime,
      disciplineIndex,
      lessonTypeIndex,
      locationIndex
    ] = tuple;
    assertNonEmptyString(locator, `manifest.decisions[${decisionIndex}].locator`);
    assertNonEmptyString(startTime, `manifest.decisions[${decisionIndex}].startTime`);
    assertNonEmptyString(endTime, `manifest.decisions[${decisionIndex}].endTime`);
    assertIndex(disciplineIndex, manifest.disciplineTable, `manifest.decisions[${decisionIndex}].disciplineIndex`);
    assertIndex(lessonTypeIndex, manifest.lessonTypeTable, `manifest.decisions[${decisionIndex}].lessonTypeIndex`);
    assertIndex(locationIndex, manifest.locationTable, `manifest.decisions[${decisionIndex}].locationIndex`);

    const discipline = manifest.disciplineTable[disciplineIndex];
    const lessonType = manifest.lessonTypeTable[lessonTypeIndex];
    const location = manifest.locationTable[locationIndex];
    const assessment = manifest.assessmentMetadataByDisciplineIndex?.[String(disciplineIndex)] ?? null;
    const groups = selectByMask(manifest.groupTable, groupMaskHex, `manifest.decisions[${decisionIndex}].groupMaskHex`);
    const dates = selectByMask(manifest.dateTable, dateMaskHex, `manifest.decisions[${decisionIndex}].dateMaskHex`);

    for (const groupId of groups) {
      for (const date of dates) {
        const sourceLocator = `${manifest.sheetName}!${locator}`;
        const eventKey = [groupId, date, startTime, endTime, discipline, lessonType, sourceLocator].join('|');
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
          lessonType,
          teacher: null,
          location,
          sourceRef: { sourceId, locator: sourceLocator }
        };
        if (assessment != null) event.assessment = structuredClone(assessment);
        events.push(event);
      }
    }
  }

  return events.sort((a, b) => [
    Number(a.groupId) - Number(b.groupId),
    a.date.localeCompare(b.date),
    a.startTime.localeCompare(b.startTime),
    a.endTime.localeCompare(b.endTime),
    a.discipline.localeCompare(b.discipline),
    a.lessonType.localeCompare(b.lessonType),
    a.sourceRef.locator.localeCompare(b.sourceRef.locator)
  ].find((value) => value !== 0) ?? 0);
}
