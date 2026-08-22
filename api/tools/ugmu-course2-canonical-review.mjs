#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { postprocessSchedule } from "../src/schedule/postprocess.js";
import { validatePostprocessedSchedule, validateScheduleBatch } from "../src/schedule/validate.js";
import { versionSchedule } from "../src/schedule/versioning.js";

const STREAMS = new Map([
  [1, {
    sha256: "8b81f37b517dd037c090b0d980ba4d916557f36c872fe0fc37031d4ae8808c6a",
    groups: Array.from({ length: 12 }, (_, index) => `ОЛД ${201 + index}`),
    eventCount: 2788,
    approvedOverlapCount: 0,
  }],
  [2, {
    sha256: "07675a77bdb80080ea018a73750f00f458cc100fcd01a63ecaf142430bca94bd",
    groups: Array.from({ length: 12 }, (_, index) => `ОЛД ${213 + index}`),
    eventCount: 2779,
    approvedOverlapCount: 32,
  }],
  [3, {
    sha256: "b6cc586f29a20bd008b5da89129809db7fbed8b2a9224a9f2d4cd3e3a77a9b85",
    groups: Array.from({ length: 12 }, (_, index) => `ОЛД ${225 + index}`),
    eventCount: 2742,
    approvedOverlapCount: 0,
  }],
  [4, {
    sha256: "6b5f87dc7f565169105245a397996e61e94794dfe580529cc5f7398a62e21517",
    groups: Array.from({ length: 12 }, (_, index) => `ОЛД ${237 + index}`),
    eventCount: 2747,
    approvedOverlapCount: 32,
  }],
]);

const EXPECTED_GROUP_COUNT = 48;
const EXPECTED_EVENT_COUNT = 11056;
const EXPECTED_APPROVED_OVERLAP_COUNT = 64;
const REVIEW_NOW = "2026-08-23T00:00:00.000Z";

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    if (match) values.set(match[1], match[2]);
  }
  const required = ["stream1", "stream2", "stream3", "stream4", "output-dir"];
  for (const key of required) {
    if (!values.get(key)) throw new Error(`Missing --${key}=...`);
  }
  return values;
}

function loadJson(file) {
  return JSON.parse(readFileSync(resolve(file), "utf8"));
}

function sourceFileName(sourceUrl) {
  try {
    const pathname = new URL(sourceUrl).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "ugmu-source.pdf");
  } catch {
    return basename(sourceUrl || "ugmu-source.pdf");
  }
}

function minutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function emptyDerived() {
  return {
    academic_week: null,
    sequence: { index: null, total: null, bucket: null },
    next_same_event: null,
    is_last_same_event: false,
    day: {
      index: null,
      total: null,
      remaining: null,
      next_event: null,
      gap_minutes: null,
      overlaps_next: false,
    },
    cycle: null,
    assessment: null,
  };
}

function normalized(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function locationInfo(event) {
  if (event.lessonTypeSemantic === "lecture") {
    return { locations: [{ raw: "Онлайн", building: null, room: null, address: null }], locationNote: null };
  }
  const address = String(event.referenceAddressRaw || "").trim();
  if (!address) return { locations: [], locationNote: null };
  if (/место\s+проведения/i.test(address)) {
    return { locations: [], locationNote: address };
  }
  return {
    locations: [{ raw: address, building: null, room: null, address }],
    locationNote: null,
  };
}

function sourceNote(event, locationNote) {
  const notes = [];
  if (event.referenceDepartment) notes.push(`Кафедра: ${event.referenceDepartment}`);
  if (locationNote) notes.push(locationNote);
  return notes.length ? notes.join("; ") : null;
}

function eventSignature(event) {
  return [
    event.group,
    event.date,
    event.startTime,
    event.endTime,
    event.titleSemantic,
    event.lessonTypeSemantic,
    event.markerRaw ?? "",
  ].join("\u0001");
}

function canonicalSignature(event) {
  return [
    event.audience.group,
    event.timing.date,
    event.timing.start_time,
    event.timing.end_time,
    event.lesson.discipline.normalized,
    event.lesson.type.code,
    event.lesson.type.raw ?? "",
  ].join("\u0001");
}

function overlapPairKey(leftSignature, rightSignature) {
  return [leftSignature, rightSignature].sort().join("\u0002");
}

function approvedOverlapPairKeys(dated) {
  const keys = new Set();
  for (const overlap of dated.review?.approvedSourceOverlaps || []) {
    const common = { group: overlap.group, date: overlap.date };
    const left = eventSignature({
      ...common,
      startTime: overlap.left.startTime,
      endTime: overlap.left.endTime,
      titleSemantic: overlap.left.titleSemantic,
      lessonTypeSemantic: overlap.left.lessonTypeSemantic,
      markerRaw: overlap.left.markerRaw,
    });
    const right = eventSignature({
      ...common,
      startTime: overlap.right.startTime,
      endTime: overlap.right.endTime,
      titleSemantic: overlap.right.titleSemantic,
      lessonTypeSemantic: overlap.right.lessonTypeSemantic,
      markerRaw: overlap.right.markerRaw,
    });
    keys.add(overlapPairKey(left, right));
  }
  return keys;
}

function requireDatedBoundary(dated, stream) {
  const expected = STREAMS.get(stream);
  if (dated?.mode !== "dated-events-review-only" || dated?.university !== "ugmu" || dated?.program !== "medicine") {
    throw new Error(`Stream ${stream}: unexpected dated review mode/scope`);
  }
  if (dated.course !== 2 || dated.stream !== stream) throw new Error(`Stream ${stream}: course/stream mismatch`);
  if (dated.source?.sha256 !== expected.sha256) throw new Error(`Stream ${stream}: source SHA changed; manual review required`);
  if (dated.effectivePeriod?.start !== "2026-09-01" || dated.effectivePeriod?.end !== "2026-12-23") {
    throw new Error(`Stream ${stream}: effective period changed`);
  }
  if (dated.weekAnchors?.I !== "2026-09-01" || dated.weekAnchors?.II !== "2026-09-07") {
    throw new Error(`Stream ${stream}: week anchors changed`);
  }
  if (JSON.stringify(Object.keys(dated.groups || {})) !== JSON.stringify(expected.groups)) {
    throw new Error(`Stream ${stream}: group set/order changed`);
  }
  if (dated.summary?.eventCount !== expected.eventCount) throw new Error(`Stream ${stream}: dated event count changed`);
  if (dated.summary?.duplicateCount !== 0 || dated.summary?.invalidIntervalCount !== 0) {
    throw new Error(`Stream ${stream}: duplicates or invalid intervals remain`);
  }
  if ((dated.summary?.approvedSourceOverlapCount || 0) !== expected.approvedOverlapCount) {
    throw new Error(`Stream ${stream}: approved source overlap count changed`);
  }
  if ((dated.summary?.unresolvedOverlapCount || 0) !== 0 || dated.summary?.reviewRequired !== false) {
    throw new Error(`Stream ${stream}: unresolved review state remains`);
  }
  if (dated.summary?.canonicalizationPerformed !== false || dated.summary?.storageWritesPerformed !== false) {
    throw new Error(`Stream ${stream}: input is not a review-only dated layer`);
  }
}

function canonicalEvent(event, dated, stream, approvedEventSignatures) {
  const { locations, locationNote } = locationInfo(event);
  const rules = [
    "UGMU-WEEKLY-GRID-V1",
    "UGMU-I-II-WEEK-ANCHORS",
    "UGMU-REFERENCE-TABLE-NORMALIZATION",
    `UGMU-COURSE2-STREAM-${stream}-REVIEWED`,
  ];
  if (event.lessonTypeSemantic === "lecture") rules.push("UGMU-LECTURE-L-PREFIX");
  if (event.lessonTypeSemantic === "lecture") rules.push("UGMU-LECTURES-ONLINE");
  if (locationNote) rules.push("UGMU-NO-FABRICATED-ADDRESS");
  if (approvedEventSignatures.has(eventSignature(event))) rules.push("UGMU-COURSE2-APPROVED-SOURCE-OVERLAP");
  if (stream === 4) rules.push("UGMU-COURSE2-STREAM4-SHA-BOUND-PERIOD-CORRECTION");

  return {
    schema_version: "1.0",
    system: {
      event_id: null,
      schedule_version_id: null,
      fingerprint: null,
      revision: null,
      created_at: null,
      updated_at: null,
    },
    university: {
      code: "ugmu",
      name: "Уральский государственный медицинский университет",
    },
    academic: {
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "medicine",
      faculty_name: "Лечебное дело",
      course: 2,
    },
    audience: {
      group: event.group,
      scope: "whole_group",
      subgroups: [],
      stream: String(stream),
    },
    timing: {
      date: event.date,
      start_time: event.startTime,
      end_time: event.endTime,
      all_day: false,
      time_mode: "floating",
    },
    lesson: {
      discipline: {
        raw: event.sourceTitleRaw,
        normalized: event.titleSemantic,
      },
      type: {
        raw: event.markerRaw ?? null,
        code: event.lessonTypeSemantic === "lecture" ? "lecture" : "other",
      },
      teachers: [],
      locations,
      source_note: sourceNote(event, locationNote),
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: sourceFileName(dated.source.url),
      file_hash: `sha256:${dated.source.sha256}`,
      sheet: null,
      references: [
        { role: "date", range: `weekly-grid:${event.group}:${event.date}` },
        { role: "time", range: `weekly-grid:${event.group}:${event.startTime}-${event.endTime}` },
        { role: "lesson", range: `weekly-grid:${event.group}:${event.sourceTitleRaw}` },
        { role: "week", range: `weekly-grid:${event.weekRuleRaw || "weekly"}` },
      ],
      raw_text: event.sourceTitleRaw,
    },
    parse: {
      status: "ok",
      rule_ids: rules,
      warnings: [],
    },
    derived: emptyDerived(),
    calendar: {
      title: null,
      description: null,
      location: null,
    },
  };
}

function buildCanonicalBatch(dated, group, stream, approvedEventSignatures) {
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "ugmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "medicine",
      course: 2,
      group,
      period: {
        start_date: dated.effectivePeriod.start,
        end_date: dated.effectivePeriod.end,
        week1_start_date: dated.weekAnchors.I,
      },
      source_files: [dated.source.url],
      generated_at: null,
      parser: `ugmu-weekly-grid/course2-stream-${stream}-controlled-review-v1`,
    },
    events: dated.groups[group].map((event) => canonicalEvent(event, dated, stream, approvedEventSignatures)),
  };
}

function findOverlaps(batch) {
  const byDate = new Map();
  for (const event of batch.events) {
    const key = `${event.audience.group}\u0001${event.timing.date}`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(event);
  }
  const overlaps = [];
  for (const items of byDate.values()) {
    items.sort((a, b) => minutes(a.timing.start_time) - minutes(b.timing.start_time) || minutes(a.timing.end_time) - minutes(b.timing.end_time));
    for (let index = 0; index < items.length; index += 1) {
      const left = items[index];
      const leftEnd = minutes(left.timing.end_time);
      for (let other = index + 1; other < items.length; other += 1) {
        const right = items[other];
        const rightStart = minutes(right.timing.start_time);
        if (rightStart >= leftEnd) break;
        if (minutes(left.timing.start_time) < minutes(right.timing.end_time)) {
          overlaps.push({ left, right });
        }
      }
    }
  }
  return overlaps;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolve(args.get("output-dir"));
  mkdirSync(outputDir, { recursive: true });

  const report = {
    version: 1,
    stage: "canonical-postprocess-review",
    university: "ugmu",
    program: "medicine",
    course: 2,
    streams: {},
    groups: {},
    summary: {},
  };

  let totalEvents = 0;
  let totalInputQa = 0;
  let totalOutputQa = 0;
  let totalDuplicates = 0;
  let totalOverlaps = 0;
  let totalApprovedOverlaps = 0;
  let totalUnresolvedOverlaps = 0;

  for (const stream of [1, 2, 3, 4]) {
    const dated = loadJson(args.get(`stream${stream}`));
    requireDatedBoundary(dated, stream);
    const expected = STREAMS.get(stream);
    const approvedPairKeys = approvedOverlapPairKeys(dated);
    const approvedEventSignatures = new Set();
    for (const overlap of dated.review?.approvedSourceOverlaps || []) {
      for (const side of [overlap.left, overlap.right]) {
        approvedEventSignatures.add(eventSignature({
          group: overlap.group,
          date: overlap.date,
          startTime: side.startTime,
          endTime: side.endTime,
          titleSemantic: side.titleSemantic,
          lessonTypeSemantic: side.lessonTypeSemantic,
          markerRaw: side.markerRaw,
        }));
      }
    }

    const streamSummary = { eventCount: 0, groupCount: 0, approvedSourceOverlapCount: 0, unresolvedOverlapCount: 0 };
    for (const group of expected.groups) {
      const canonical = buildCanonicalBatch(dated, group, stream, approvedEventSignatures);
      const inputQa = validateScheduleBatch(canonical);
      if (!inputQa.publishable) {
        throw new Error(`${group}: canonical input QA failed: ${JSON.stringify(inputQa.errors.slice(0, 5))}`);
      }

      const groupNumber = group.match(/\d+/)?.[0];
      const { batch: versioned, diff } = versionSchedule(null, canonical, {
        now: REVIEW_NOW,
        eventIdFactory: (_event, index) => `evt_ugmu_c2_old${groupNumber}_${String(index + 1).padStart(4, "0")}`,
        versionIdFactory: () => `ver_ugmu_c2_old${groupNumber}_controlled_review`,
      });
      const processed = postprocessSchedule(versioned, {
        includeServiceSignature: false,
        longBreakDays: 14,
      });
      const outputQa = validatePostprocessedSchedule(processed);
      if (!outputQa.publishable) {
        throw new Error(`${group}: postprocessed QA failed: ${JSON.stringify(outputQa.errors.slice(0, 5))}`);
      }

      const overlaps = findOverlaps(processed);
      let approved = 0;
      let unresolved = 0;
      for (const overlap of overlaps) {
        const pairKey = overlapPairKey(canonicalSignature(overlap.left), canonicalSignature(overlap.right));
        if (approvedPairKeys.has(pairKey)) approved += 1;
        else unresolved += 1;
      }
      if (unresolved !== 0) throw new Error(`${group}: ${unresolved} unexpected canonical overlap(s)`);

      const groupReport = {
        stream,
        eventCount: processed.events.length,
        inputQaPublishable: inputQa.publishable,
        outputQaPublishable: outputQa.publishable,
        duplicateCount: outputQa.stats.duplicates,
        overlapCount: overlaps.length,
        approvedSourceOverlapCount: approved,
        unresolvedOverlapCount: unresolved,
        versionDiff: diff,
        versionId: processed.schedule.schedule_version_id,
        sourceSha256: dated.source.sha256,
      };
      report.groups[group] = groupReport;
      writeFileSync(resolve(outputDir, `${group.replaceAll(" ", "-")}.json`), `${JSON.stringify(processed, null, 2)}\n`, "utf8");

      totalEvents += processed.events.length;
      totalInputQa += inputQa.publishable ? 1 : 0;
      totalOutputQa += outputQa.publishable ? 1 : 0;
      totalDuplicates += outputQa.stats.duplicates;
      totalOverlaps += overlaps.length;
      totalApprovedOverlaps += approved;
      totalUnresolvedOverlaps += unresolved;
      streamSummary.eventCount += processed.events.length;
      streamSummary.groupCount += 1;
      streamSummary.approvedSourceOverlapCount += approved;
      streamSummary.unresolvedOverlapCount += unresolved;
    }
    if (streamSummary.eventCount !== expected.eventCount || streamSummary.groupCount !== expected.groups.length) {
      throw new Error(`Stream ${stream}: canonical totals changed`);
    }
    if (streamSummary.approvedSourceOverlapCount !== expected.approvedOverlapCount || streamSummary.unresolvedOverlapCount !== 0) {
      throw new Error(`Stream ${stream}: canonical overlap policy changed`);
    }
    report.streams[String(stream)] = streamSummary;
  }

  report.summary = {
    groupCount: Object.keys(report.groups).length,
    eventCount: totalEvents,
    inputQaPassedGroups: totalInputQa,
    outputQaPassedGroups: totalOutputQa,
    duplicateCount: totalDuplicates,
    overlapCount: totalOverlaps,
    approvedSourceOverlapCount: totalApprovedOverlaps,
    unresolvedOverlapCount: totalUnresolvedOverlaps,
    canonicalizationPerformed: true,
    versioningPerformed: true,
    postprocessingPerformed: true,
    icsGenerated: false,
    storageWritesPerformed: false,
    publicationAllowed: false,
    reviewRequired: totalDuplicates !== 0 || totalUnresolvedOverlaps !== 0,
  };

  if (report.summary.groupCount !== EXPECTED_GROUP_COUNT) throw new Error(`Expected ${EXPECTED_GROUP_COUNT} groups`);
  if (report.summary.eventCount !== EXPECTED_EVENT_COUNT) throw new Error(`Expected ${EXPECTED_EVENT_COUNT} events`);
  if (report.summary.inputQaPassedGroups !== EXPECTED_GROUP_COUNT || report.summary.outputQaPassedGroups !== EXPECTED_GROUP_COUNT) {
    throw new Error("Not all groups passed canonical/postprocessed QA");
  }
  if (report.summary.duplicateCount !== 0) throw new Error("Canonical duplicates detected");
  if (report.summary.approvedSourceOverlapCount !== EXPECTED_APPROVED_OVERLAP_COUNT || report.summary.overlapCount !== EXPECTED_APPROVED_OVERLAP_COUNT) {
    throw new Error("Approved source overlap total changed");
  }
  if (report.summary.unresolvedOverlapCount !== 0 || report.summary.reviewRequired !== false) {
    throw new Error("Unexpected canonical review blockers remain");
  }

  writeFileSync(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.summary));
}

main();
