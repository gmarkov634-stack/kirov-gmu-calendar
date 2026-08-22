#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalizeUgmuMedicineCourse2Reviewed } from "../src/adapters/ugmu/canonical.mjs";
import { prepareSchedulePublication } from "../src/schedule/pipeline.js";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function groupNumber(groupCode) {
  const match = String(groupCode || "").match(/(\d{3})$/);
  if (!match) throw new Error(`Unexpected UGMU course-2 group code: ${groupCode}`);
  return match[1];
}

function veventCount(ics) {
  return (String(ics).match(/BEGIN:VEVENT/g) || []).length;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(arg("root", "data/imports/ugmu-course2/raw"));
const output = path.resolve(arg("output", path.join(root, "adapter-qa.json")));
const now = "2026-08-22T15:00:00.000Z";
const groups = [];
let eventTotal = 0;
let confirmedSourceOverlaps = 0;

for (const stream of ["1", "2", "3", "4"]) {
  const streamDir = path.join(root, `stream-${stream}`);
  const files = (await readdir(streamDir))
    .filter((name) => /^ОЛД-\d{3}\.json$/u.test(name))
    .sort((a, b) => a.localeCompare(b, "ru"));

  requireValue(files.length === 12, `UGMU course-2 stream ${stream}: expected 12 group files, got ${files.length}`);

  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(streamDir, file), "utf8"));
    const groupCode = raw.group?.code;
    const groupNo = groupNumber(groupCode);
    const canonical = canonicalizeUgmuMedicineCourse2Reviewed(raw);

    requireValue(canonical.schedule.course === 2, `${groupCode}: canonical course mismatch`);
    requireValue(canonical.schedule.group === groupCode, `${groupCode}: canonical group mismatch`);
    requireValue(canonical.schedule.academic_year === "2026/2027", `${groupCode}: canonical academic year mismatch`);
    requireValue(canonical.schedule.semester === "autumn", `${groupCode}: canonical semester mismatch`);
    requireValue(canonical.events.length === raw.events.length, `${groupCode}: canonical event count changed`);
    requireValue(canonical.events.every((event) => event.audience?.stream === stream), `${groupCode}: canonical stream mismatch`);
    requireValue(canonical.events.every((event) => event.academic?.course === 2), `${groupCode}: canonical event course mismatch`);

    const prepared = prepareSchedulePublication(canonical, {
      now,
      eventIdFactory: (_event, index) => `evt_ugmu_old${groupNo}_${String(index + 1).padStart(4, "0")}`,
      versionIdFactory: () => `ver_ugmu_old${groupNo}_course2_qa`,
      postprocessOptions: {
        includeServiceSignature: false,
        longBreakDays: 14,
      },
    });

    requireValue(prepared.inputQa.publishable === true, `${groupCode}: canonical input QA rejected schedule`);
    requireValue(prepared.outputQa.publishable === true, `${groupCode}: postprocessed QA rejected schedule`);
    requireValue(prepared.batch.events.length === raw.events.length, `${groupCode}: publication pipeline event count changed`);
    requireValue(prepared.ics.startsWith("BEGIN:VCALENDAR"), `${groupCode}: ICS does not start with VCALENDAR`);
    requireValue(prepared.ics.includes("END:VCALENDAR"), `${groupCode}: ICS does not end with VCALENDAR`);
    requireValue(veventCount(prepared.ics) === raw.events.length, `${groupCode}: ICS VEVENT count mismatch`);
    requireValue(raw.sourceReview?.publicationAllowed === false, `${groupCode}: source unexpectedly became publishable`);

    const overlaps = Number(raw.sourceReview?.confirmedSourceOverlapCount || 0);
    confirmedSourceOverlaps += overlaps;
    eventTotal += raw.events.length;
    groups.push({
      group: groupCode,
      stream,
      events: raw.events.length,
      confirmedSourceOverlaps: overlaps,
      inputPublishable: prepared.inputQa.publishable,
      outputPublishable: prepared.outputQa.publishable,
      icsEvents: veventCount(prepared.ics),
      icsBytes: Buffer.byteLength(prepared.ics, "utf8"),
      sourcePublicationAllowed: raw.sourceReview.publicationAllowed,
    });
  }
}

requireValue(groups.length === 48, `UGMU course-2 adapter QA expected 48 groups, got ${groups.length}`);
requireValue(eventTotal === 10704, `UGMU course-2 adapter QA expected 10704 events, got ${eventTotal}`);
requireValue(confirmedSourceOverlaps === 32, `UGMU course-2 adapter QA expected 32 confirmed source overlaps, got ${confirmedSourceOverlaps}`);

const report = {
  version: 1,
  university: "ugmu",
  program: "medicine",
  course: 2,
  academicYear: "2026/2027",
  semester: 1,
  canonicalQa: "pass",
  publicationPipelineQa: "pass",
  icsQa: "pass",
  groupCount: groups.length,
  eventCount: eventTotal,
  confirmedSourceOverlaps,
  storageWrites: 0,
  publicationAllowed: false,
  active: false,
  checkoutEnabled: false,
  salesEnabled: false,
  groups,
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  course2AdapterQa: "pass",
  groups: report.groupCount,
  events: report.eventCount,
  confirmedSourceOverlaps: report.confirmedSourceOverlaps,
  storageWrites: report.storageWrites,
  publicationAllowed: report.publicationAllowed,
}));
