import { createHash, randomUUID } from "node:crypto";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function audienceSignature(event) {
  const audience = event?.audience || {};
  return stableStringify({
    group: String(audience.group ?? ""),
    scope: audience.scope ?? null,
    subgroups: [...(audience.subgroups || [])].map(String).sort(),
    stream: audience.stream ?? null,
  });
}

function sourceSignature(event) {
  const source = event?.source || {};
  const refs = (source.references || [])
    .map((ref) => ({ role: ref?.role ?? null, range: ref?.range ?? null }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  if (!source.sheet && refs.length === 0) return null;
  return stableStringify({ sheet: source.sheet ?? null, references: refs });
}

function semanticCore(event) {
  return {
    university: event?.university ?? null,
    academic: event?.academic ?? null,
    audience: event?.audience ?? null,
    timing: event?.timing ?? null,
    lesson: event?.lesson ?? null,
  };
}

function eventFingerprint(event) {
  return `sha256:${sha256(semanticCore(event))}`;
}

function occurrenceAnchor(event) {
  return stableStringify({
    date: event?.timing?.date ?? null,
    discipline: normalizeText(event?.lesson?.discipline?.normalized),
    type: event?.lesson?.type?.code ?? null,
    audience: audienceSignature(event),
  });
}

function sourceAnchor(event) {
  const source = sourceSignature(event);
  if (!source) return null;
  return stableStringify({
    source,
    discipline: normalizeText(event?.lesson?.discipline?.normalized),
    type: event?.lesson?.type?.code ?? null,
    audience: audienceSignature(event),
  });
}

function semanticClass(event) {
  return stableStringify({
    discipline: normalizeText(event?.lesson?.discipline?.normalized),
    type: event?.lesson?.type?.code ?? null,
    audience: audienceSignature(event),
  });
}

function collectBy(items, indexes, keyFn) {
  const map = new Map();
  for (const index of indexes) {
    const key = keyFn(items[index]);
    if (key === null || key === undefined) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  }
  return map;
}

function pairUnique(oldEvents, newEvents, oldOpen, newOpen, keyFn, pairs, method) {
  const oldMap = collectBy(oldEvents, oldOpen, keyFn);
  const newMap = collectBy(newEvents, newOpen, keyFn);
  for (const [key, oldIndexes] of oldMap) {
    const newIndexes = newMap.get(key);
    if (oldIndexes.length !== 1 || !newIndexes || newIndexes.length !== 1) continue;
    const oldIndex = oldIndexes[0];
    const newIndex = newIndexes[0];
    if (!oldOpen.has(oldIndex) || !newOpen.has(newIndex)) continue;
    pairs.push({ oldIndex, newIndex, method });
    oldOpen.delete(oldIndex);
    newOpen.delete(newIndex);
  }
}

function pairByExistingId(oldEvents, newEvents, oldOpen, newOpen, pairs) {
  const oldIds = new Map();
  for (const index of oldOpen) {
    const id = oldEvents[index]?.system?.event_id;
    if (!id) continue;
    if (!oldIds.has(id)) oldIds.set(id, []);
    oldIds.get(id).push(index);
  }
  for (const newIndex of [...newOpen]) {
    const id = newEvents[newIndex]?.system?.event_id;
    if (!id) continue;
    const candidates = oldIds.get(id) || [];
    if (candidates.length !== 1) continue;
    const oldIndex = candidates[0];
    if (!oldOpen.has(oldIndex)) continue;
    pairs.push({ oldIndex, newIndex, method: "event_id" });
    oldOpen.delete(oldIndex);
    newOpen.delete(newIndex);
  }
}

function matchEvents(previousEvents, incomingEvents) {
  const oldOpen = new Set(previousEvents.map((_, index) => index));
  const newOpen = new Set(incomingEvents.map((_, index) => index));
  const pairs = [];

  pairByExistingId(previousEvents, incomingEvents, oldOpen, newOpen, pairs);
  pairUnique(previousEvents, incomingEvents, oldOpen, newOpen, occurrenceAnchor, pairs, "occurrence_anchor");
  pairUnique(previousEvents, incomingEvents, oldOpen, newOpen, sourceAnchor, pairs, "source_anchor");
  pairUnique(previousEvents, incomingEvents, oldOpen, newOpen, semanticClass, pairs, "single_semantic_pair");

  return {
    pairs,
    removedIndexes: [...oldOpen].sort((a, b) => a - b),
    addedIndexes: [...newOpen].sort((a, b) => a - b),
  };
}

function eventIdFactory() {
  return `evt_${randomUUID().replaceAll("-", "")}`;
}

function clone(value) {
  return structuredClone(value);
}

function comparableFields(event) {
  return {
    university: event?.university ?? null,
    academic: event?.academic ?? null,
    audience: event?.audience ?? null,
    timing: event?.timing ?? null,
    lesson: event?.lesson ?? null,
  };
}

function diffValues(before, after, path = "") {
  if (stableStringify(before) === stableStringify(after)) return [];
  const beforeObject = before !== null && typeof before === "object" && !Array.isArray(before);
  const afterObject = after !== null && typeof after === "object" && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffValues(before[key], after[key], `${path}/${key}`));
  }
  return [{ path: path || "/", before: before ?? null, after: after ?? null }];
}

function scheduleContentFingerprint(schedule, events) {
  const scheduleIdentity = {
    university_code: schedule?.university_code ?? null,
    academic_year: schedule?.academic_year ?? null,
    semester: schedule?.semester ?? null,
    faculty_code: schedule?.faculty_code ?? null,
    course: schedule?.course ?? null,
    group: schedule?.group ?? null,
    period: schedule?.period ?? null,
  };
  const fingerprints = events.map(eventFingerprint).sort();
  return `sha256:${sha256({ schedule: scheduleIdentity, events: fingerprints })}`;
}

function versionIdFactory() {
  return `ver_${randomUUID().replaceAll("-", "")}`;
}

function isoNow(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("options.now must be a valid date/time");
  return date.toISOString();
}

function positiveRevision(value) {
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function summarizeEvent(event) {
  return {
    event_id: event?.system?.event_id ?? null,
    revision: event?.system?.revision ?? null,
    date: event?.timing?.date ?? null,
    start_time: event?.timing?.start_time ?? null,
    end_time: event?.timing?.end_time ?? null,
    discipline: event?.lesson?.discipline?.normalized ?? null,
    type_code: event?.lesson?.type?.code ?? null,
    group: event?.audience?.group ?? null,
    subgroups: event?.audience?.subgroups ?? [],
  };
}

export function versionSchedule(previousBatch, incomingBatch, options = {}) {
  if (!incomingBatch?.schedule || !Array.isArray(incomingBatch.events)) {
    throw new TypeError("incoming schedule-batch with schedule and events is required");
  }
  if (previousBatch && (!previousBatch.schedule || !Array.isArray(previousBatch.events))) {
    throw new TypeError("previous schedule-batch must contain schedule and events");
  }

  const idFactory = options.eventIdFactory || eventIdFactory;
  const previousEvents = previousBatch?.events || [];
  const result = clone(incomingBatch);
  const incomingEvents = result.events;
  const matching = matchEvents(previousEvents, incomingEvents);
  const pairByNew = new Map(matching.pairs.map((pair) => [pair.newIndex, pair]));

  for (let index = 0; index < incomingEvents.length; index += 1) {
    const event = incomingEvents[index];
    const pair = pairByNew.get(index);
    const previousEvent = pair ? previousEvents[pair.oldIndex] : null;
    const existingId = previousEvent?.system?.event_id || event?.system?.event_id || null;
    event.system = {
      ...(event.system || {}),
      event_id: existingId || idFactory(event, index),
      schedule_version_id: null,
      fingerprint: eventFingerprint(event),
    };
  }

  const contentFingerprint = scheduleContentFingerprint(result.schedule, incomingEvents);
  const previousVersionId = previousBatch?.schedule?.schedule_version_id
    || previousBatch?.events?.find((event) => event?.system?.schedule_version_id)?.system?.schedule_version_id
    || null;
  const previousContentFingerprint = previousBatch
    ? (previousBatch.schedule?.content_fingerprint || scheduleContentFingerprint(previousBatch.schedule, previousEvents))
    : null;
  const sameContent = Boolean(previousBatch && previousContentFingerprint === contentFingerprint);
  const versionId = sameContent && previousVersionId
    ? previousVersionId
    : (options.versionIdFactory
        ? options.versionIdFactory({ contentFingerprint, previousBatch, incomingBatch: result })
        : versionIdFactory());
  const parentVersionId = sameContent
    ? (previousBatch?.schedule?.previous_schedule_version_id ?? null)
    : previousVersionId;
  const generatedNow = isoNow(options.now);
  const previousVersionCreatedAt = previousBatch?.schedule?.version_created_at ?? null;
  const versionCreatedAt = sameContent && previousVersionCreatedAt
    ? previousVersionCreatedAt
    : generatedNow;

  result.schedule = {
    ...result.schedule,
    schedule_version_id: versionId,
    previous_schedule_version_id: parentVersionId,
    content_fingerprint: contentFingerprint,
    version_created_at: versionCreatedAt,
  };

  const changed = [];
  const unchanged = [];
  for (const pair of matching.pairs) {
    const before = previousEvents[pair.oldIndex];
    const after = incomingEvents[pair.newIndex];
    const changes = diffValues(comparableFields(before), comparableFields(after));
    const beforeRevision = positiveRevision(before?.system?.revision);
    const createdAt = before?.system?.created_at || previousVersionCreatedAt || versionCreatedAt;
    if (changes.length) {
      after.system.revision = beforeRevision + 1;
      after.system.created_at = createdAt;
      after.system.updated_at = versionCreatedAt;
      changed.push({
        ...summarizeEvent(after),
        status: "changed",
        matched_by: pair.method,
        changes,
      });
    } else {
      after.system.revision = beforeRevision;
      after.system.created_at = createdAt;
      after.system.updated_at = before?.system?.updated_at || previousVersionCreatedAt || versionCreatedAt;
      unchanged.push({
        ...summarizeEvent(after),
        status: "unchanged",
        matched_by: pair.method,
      });
    }
  }

  const added = matching.addedIndexes.map((index) => {
    const event = incomingEvents[index];
    event.system.revision = 1;
    event.system.created_at = versionCreatedAt;
    event.system.updated_at = versionCreatedAt;
    return {
      ...summarizeEvent(event),
      status: "added",
    };
  });

  for (const event of incomingEvents) event.system.schedule_version_id = versionId;

  const removed = matching.removedIndexes.map((index) => ({
    ...summarizeEvent(previousEvents[index]),
    status: "removed",
  }));

  const diff = {
    previous_version_id: previousVersionId,
    version_id: versionId,
    version_created_at: versionCreatedAt,
    content_fingerprint: contentFingerprint,
    same_content: sameContent,
    counts: {
      added: added.length,
      changed: changed.length,
      removed: removed.length,
      unchanged: unchanged.length,
      total_new: incomingEvents.length,
    },
    added,
    changed,
    removed,
    unchanged,
  };

  return { batch: result, diff };
}

export { eventFingerprint, scheduleContentFingerprint, matchEvents };
