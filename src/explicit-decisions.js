import { createHash } from 'node:crypto';

const DECISION_SCHEMA_V3 = 'kgmu-explicit-semantic-decisions-v3';
const DECISION_SCHEMA_V4 = 'kgmu-explicit-semantic-decisions-v4';
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

function normalizeSelectionMetadata(manifest) {
  if (manifest.selectionMetadataByDisciplineIndex == null) return new Map();
  const metadata = assertObject(
    manifest.selectionMetadataByDisciplineIndex,
    'manifest.selectionMetadataByDisciplineIndex'
  );
  const result = new Map();
  for (const [rawIndex, selection] of Object.entries(metadata)) {
    if (!/^\d+$/.test(rawIndex)) {
      throw new TypeError('manifest.selectionMetadataByDisciplineIndex keys must be discipline indexes');
    }
    const disciplineIndex = Number(rawIndex);
    assertIndex(
      disciplineIndex,
      manifest.disciplineTable,
      `manifest.selectionMetadataByDisciplineIndex[${rawIndex}]`
    );
    assertObject(selection, `manifest.selectionMetadataByDisciplineIndex[${rawIndex}]`);
    const selectionGroupId = assertNonEmptyString(
      selection.selectionGroupId,
      `manifest.selectionMetadataByDisciplineIndex[${rawIndex}].selectionGroupId`
    );
    const selectionOptionId = assertNonEmptyString(
      selection.selectionOptionId,
      `manifest.selectionMetadataByDisciplineIndex[${rawIndex}].selectionOptionId`
    );
    result.set(disciplineIndex, Object.freeze({ selectionGroupId, selectionOptionId }));
  }
  return result;
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

function decodeDecisionTuple(manifest, tuple, decisionIndex) {
  const label = `manifest.decisions[${decisionIndex}]`;
  if (manifest.schema === DECISION_SCHEMA_V3) {
    if (!Array.isArray(tuple) || tuple.length !== 8) {
      throw new TypeError(`${label} must contain exactly 8 fields`);
    }
    const [locator, groupMaskHex, dateMaskHex, startTime, endTime, disciplineIndex, lessonTypeIndex, locationIndex] = tuple;
    assertNonEmptyString(startTime, `${label}.startTime`);
    assertNonEmptyString(endTime, `${label}.endTime`);
    return {
      locator,
      groupMaskHex,
      dateMaskHex,
      timeSemantics: 'floating',
      startTime,
      endTime,
      disciplineIndex,
      lessonTypeIndex,
      locationIndex,
      legacyEventKey: true
    };
  }

  if (manifest.schema === DECISION_SCHEMA_V4) {
    if (!Array.isArray(tuple) || tuple.length !== 9) {
      throw new TypeError(`${label} must contain exactly 9 fields`);
    }
    const [
      locator,
      groupMaskHex,
      dateMaskHex,
      timeSemantics,
      startTime,
      endTime,
      disciplineIndex,
      lessonTypeIndex,
      locationIndex
    ] = tuple;
    if (timeSemantics === 'floating') {
      assertNonEmptyString(startTime, `${label}.startTime`);
      assertNonEmptyString(endTime, `${label}.endTime`);
    } else if (timeSemantics === 'date-only') {
      if (startTime !== null || endTime !== null) {
        throw new TypeError(`${label} date-only decision must use null startTime/endTime`);
      }
    } else {
      throw new TypeError(`${label}.timeSemantics must be floating or date-only`);
    }
    return {
      locator,
      groupMaskHex,
      dateMaskHex,
      timeSemantics,
      startTime,
      endTime,
      disciplineIndex,
      lessonTypeIndex,
      locationIndex,
      legacyEventKey: false
    };
  }

  throw new Error(`unsupported explicit decision schema: ${manifest.schema}`);
}

export function expandExplicitDecisionManifest(manifest, context) {
  assertObject(manifest, 'manifest');
  assertObject(context, 'context');
  if (![DECISION_SCHEMA_V3, DECISION_SCHEMA_V4].includes(manifest.schema)) {
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

  const selectionMetadata = normalizeSelectionMetadata(manifest);
  const events = [];
  for (const [decisionIndex, rawTuple] of manifest.decisions.entries()) {
    const decision = decodeDecisionTuple(manifest, rawTuple, decisionIndex);
    const {
      locator,
      groupMaskHex,
      dateMaskHex,
      timeSemantics,
      startTime,
      endTime,
      disciplineIndex,
      lessonTypeIndex,
      locationIndex,
      legacyEventKey
    } = decision;
    assertNonEmptyString(locator, `manifest.decisions[${decisionIndex}].locator`);
    assertIndex(disciplineIndex, manifest.disciplineTable, `manifest.decisions[${decisionIndex}].disciplineIndex`);
    assertIndex(lessonTypeIndex, manifest.lessonTypeTable, `manifest.decisions[${decisionIndex}].lessonTypeIndex`);
    assertIndex(locationIndex, manifest.locationTable, `manifest.decisions[${decisionIndex}].locationIndex`);

    const discipline = manifest.disciplineTable[disciplineIndex];
    const lessonType = manifest.lessonTypeTable[lessonTypeIndex];
    const location = manifest.locationTable[locationIndex];
    const assessment = manifest.assessmentMetadataByDisciplineIndex?.[String(disciplineIndex)] ?? null;
    const selection = selectionMetadata.get(disciplineIndex) ?? null;
    const groups = selectByMask(manifest.groupTable, groupMaskHex, `manifest.decisions[${decisionIndex}].groupMaskHex`);
    const dates = selectByMask(manifest.dateTable, dateMaskHex, `manifest.decisions[${decisionIndex}].dateMaskHex`);

    for (const groupId of groups) {
      for (const date of dates) {
        const sourceLocator = `${manifest.sheetName}!${locator}`;
        const eventKeyParts = legacyEventKey
          ? [groupId, date, startTime, endTime, discipline, lessonType, sourceLocator]
          : [groupId, date, timeSemantics, startTime ?? '', endTime ?? '', discipline, lessonType, sourceLocator];
        if (selection != null) {
          eventKeyParts.push(selection.selectionGroupId, selection.selectionOptionId);
        }
        const eventKey = eventKeyParts.join('|');
        const event = {
          eventId: `kgmu-${sha256Hex(eventKey).slice(0, 24)}`,
          universityId,
          groupId,
          academicPeriodId,
          date,
          timeSemantics,
          discipline,
          lessonType,
          teacher: null,
          location,
          sourceRef: { sourceId, locator: sourceLocator }
        };
        if (timeSemantics === 'floating') {
          event.startTime = startTime;
          event.endTime = endTime;
        }
        if (assessment != null) event.assessment = structuredClone(assessment);
        if (selection != null) event.selection = structuredClone(selection);
        events.push(event);
      }
    }
  }

  return events.sort((a, b) => [
    Number(a.groupId) - Number(b.groupId),
    a.date.localeCompare(b.date),
    (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    (a.endTime ?? '').localeCompare(b.endTime ?? ''),
    a.discipline.localeCompare(b.discipline),
    a.lessonType.localeCompare(b.lessonType),
    a.sourceRef.locator.localeCompare(b.sourceRef.locator)
  ].find((value) => value !== 0) ?? 0);
}
