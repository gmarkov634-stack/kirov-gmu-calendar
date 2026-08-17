import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { buildWeeklyGridCanonicalCandidate } from "../src/adapters/omgmu/weekly-grid.mjs";
import { createHandler } from "../src/app.js";
import { scheduleContext } from "../src/order-context.js";
import { publishScheduleBatch } from "../src/schedule/pipeline.js";
import { YearAwareStore } from "../src/year-aware-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "O".repeat(43);
const SOURCE_FILE = "03_medicine-international_course-2_stream-1_combined.pdf";
const SOURCE_SHA = "f34129fe1a98ca8935620fce10b3adab7ca3858e5f5e842fe38bcfc85491d3da";

function geometryFixture() {
  const encoded = fs.readFileSync(path.join(__dirname, "fixtures", "omgmu-weekly-course2-stream1.geometry.json.gz.b64"), "utf8").trim();
  return JSON.parse(zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
}

function canonical2101() {
  const candidate = buildWeeklyGridCanonicalCandidate(geometryFixture(), {
    metadata: {
      academicYear: "2025/2026",
      semester: "spring",
      facultyCode: "medicine-international",
      facultyName: "Лечебное дело для иностранных граждан",
      course: 2,
      stream: "1",
      group: "2101",
      period: {
        start_date: "2026-04-01",
        end_date: "2026-08-08",
        week1_start_date: "2026-03-30",
      },
      calendarExceptions: ["2026-05-01", "2026-05-09", "2026-06-12"],
    },
    source: { fileName: SOURCE_FILE, fileHash: SOURCE_SHA },
  });
  assert.equal(candidate.review, null);
  assert.ok(candidate.batch.events.length > 50);
  assert.ok(candidate.batch.events.every((event) => event.parse.status !== "needs_review"));
  return structuredClone(candidate.batch);
}

function plusMinutes(value, minutes) {
  const [hour, minute] = value.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function compactTime(value) {
  return value.replace(":", "") + "00";
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function findTarget(batch, anchor) {
  return batch.events.find((event) =>
    event.timing.date === anchor.date &&
    event.timing.start_time === anchor.start &&
    event.lesson.discipline.normalized === anchor.discipline
  );
}

test("real ОмГМУ 2101 survives publish → same subscription URL → change → rollback", async (t) => {
  const dataDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "omgmu-e2e-"));
  t.after(() => fsPromises.rm(dataDir, { recursive: true, force: true }));

  const store = new YearAwareStore({
    dataDir,
    cacheTtlMs: 1,
    offerAcademicYear: "2025/2026",
    offerSemester: 2,
  });

  let eventCounter = 0;
  let versionCounter = 0;
  const factories = (now) => ({
    now,
    eventIdFactory: () => `evt_omgmu_e2e_${++eventCounter}`,
    versionIdFactory: () => `ver_omgmu_e2e_${++versionCounter}`,
  });

  const baselineInput = canonical2101();
  const sourceTarget = baselineInput.events.find((event) => !event.timing.all_day && event.timing.start_time && event.timing.end_time);
  assert.ok(sourceTarget, "real group 2101 must contain a timed event");
  const anchor = {
    date: sourceTarget.timing.date,
    start: sourceTarget.timing.start_time,
    discipline: sourceTarget.lesson.discipline.normalized,
  };
  const baselineEnd = sourceTarget.timing.end_time;
  const changedEnd = plusMinutes(baselineEnd, 5);

  const publicationA = await publishScheduleBatch({
    store,
    incomingBatch: structuredClone(baselineInput),
    ...factories("2026-08-15T10:00:00.000Z"),
  });
  assert.equal(publicationA.inputQa.publishable, true);
  assert.equal(publicationA.outputQa.publishable, true);
  assert.equal(publicationA.diff.counts.added, baselineInput.events.length);

  const context = scheduleContext(publicationA.batch);
  assert.equal(context.university, "omgmu");
  assert.equal(context.program, "medicine-international");
  assert.equal(context.course, 2);
  assert.equal(context.stream, "1");
  assert.equal(context.groupCode, "2101");

  const currentA = await store.getSchedule(context);
  const targetA = findTarget(currentA, anchor);
  assert.ok(targetA);
  const stableEventId = targetA.system.event_id;
  assert.equal(targetA.system.revision, 1);
  const baselineVersion = currentA.schedule.schedule_version_id;

  await store.putSubscription(TOKEN, {
    version: 2,
    status: "active",
    plan: "year",
    university: "omgmu",
    universityName: "ОмГМУ",
    program: context.program,
    course: context.course,
    stream: context.stream,
    groupCode: context.groupCode,
    groupId: context.groupId,
    groupDisplayName: `Группа ${context.groupCode}`,
    timezone: "Asia/Omsk",
    academicYear: context.academicYear,
    semester: context.semester,
    expiresAt: "2027-08-31T23:59:59+06:00",
    createdAt: "2026-08-15T10:01:00.000Z",
  });

  const handler = createHandler({
    store,
    config: {
      allowedOrigin: "https://example.test",
      enablePublicEndpoints: false,
      subscriptionSigningSecret: "s".repeat(32),
      universitySiteUrls: { omgmu: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/omgmu/" },
    },
  });

  await withServer(handler, async (base) => {
    const subscriptionUrl = `${base}/api/v1/subscriptions/${TOKEN}/calendar.ics`;

    const responseA = await fetch(subscriptionUrl);
    assert.equal(responseA.status, 200);
    assert.equal(responseA.headers.get("x-subscription-status"), "active");
    const icsA = await responseA.text();
    assert.match(icsA, new RegExp(`UID:${stableEventId}@omgmu-calendar`));
    assert.match(icsA, new RegExp(`DTSTART:${anchor.date.replaceAll("-", "")}T${compactTime(anchor.start)}`));
    assert.match(icsA, new RegExp(`DTEND:${anchor.date.replaceAll("-", "")}T${compactTime(baselineEnd)}`));
    assert.match(icsA, new RegExp(`UID:${stableEventId}@omgmu-calendar[\\s\\S]*?SEQUENCE:0`));
    assert.doesNotMatch(icsA, /TZID=/);
    assert.doesNotMatch(icsA, /\+06:00/);

    const changedInput = structuredClone(baselineInput);
    const changedSourceEvent = findTarget(changedInput, anchor);
    assert.ok(changedSourceEvent);
    changedSourceEvent.timing.end_time = changedEnd;

    const publicationB = await publishScheduleBatch({
      store,
      incomingBatch: changedInput,
      ...factories("2026-08-15T11:00:00.000Z"),
    });
    assert.equal(publicationB.diff.counts.added, 0);
    assert.equal(publicationB.diff.counts.changed, 1);
    assert.equal(publicationB.diff.counts.removed, 0);
    assert.equal(publicationB.diff.counts.unchanged, baselineInput.events.length - 1);

    const currentB = await store.getSchedule(context);
    assert.notEqual(currentB.schedule.schedule_version_id, baselineVersion);
    const targetB = currentB.events.find((event) => event.system.event_id === stableEventId);
    assert.ok(targetB);
    assert.equal(targetB.timing.end_time, changedEnd);
    assert.equal(targetB.system.revision, 2);

    const responseB = await fetch(subscriptionUrl);
    assert.equal(responseB.status, 200);
    const icsB = await responseB.text();
    assert.match(icsB, new RegExp(`UID:${stableEventId}@omgmu-calendar`));
    assert.match(icsB, new RegExp(`DTEND:${anchor.date.replaceAll("-", "")}T${compactTime(changedEnd)}`));
    assert.match(icsB, new RegExp(`UID:${stableEventId}@omgmu-calendar[\\s\\S]*?SEQUENCE:1`));

    const rollback = await publishScheduleBatch({
      store,
      incomingBatch: structuredClone(baselineInput),
      ...factories("2026-08-15T12:00:00.000Z"),
    });
    assert.equal(rollback.diff.counts.added, 0);
    assert.equal(rollback.diff.counts.changed, 1);
    assert.equal(rollback.diff.counts.removed, 0);
    assert.equal(rollback.diff.counts.unchanged, baselineInput.events.length - 1);

    const currentRollback = await store.getSchedule(context);
    const targetRollback = currentRollback.events.find((event) => event.system.event_id === stableEventId);
    assert.ok(targetRollback);
    assert.equal(targetRollback.timing.end_time, baselineEnd);
    assert.equal(targetRollback.system.revision, 3);

    const responseRollback = await fetch(subscriptionUrl);
    assert.equal(responseRollback.status, 200);
    const icsRollback = await responseRollback.text();
    assert.match(icsRollback, new RegExp(`UID:${stableEventId}@omgmu-calendar`));
    assert.match(icsRollback, new RegExp(`DTEND:${anchor.date.replaceAll("-", "")}T${compactTime(baselineEnd)}`));
    assert.match(icsRollback, new RegExp(`UID:${stableEventId}@omgmu-calendar[\\s\\S]*?SEQUENCE:2`));

    const unchanged = await publishScheduleBatch({
      store,
      incomingBatch: structuredClone(baselineInput),
      ...factories("2026-08-15T13:00:00.000Z"),
    });
    assert.equal(unchanged.diff.same_content, true);
    assert.equal(unchanged.publication.unchanged, true);
  });
});