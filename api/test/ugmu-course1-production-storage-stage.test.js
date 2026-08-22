import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkUgmuCourse1PublicBoundary,
  EXPECTED_EVENTS,
  EXPECTED_GROUPS,
  EXPECTED_STREAMS,
  stageUgmuCourse1ProductionStorage,
  validateApprovedUgmuCourse1ScheduleObject,
  validateCourse1StagingAuthority,
} from "../tools/ugmu-course1-production-storage-stage.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function response(status, body) {
  return { status, async json() { return body; } };
}

function productionBoundaryFetch() {
  return async (url, options = {}) => {
    assert.notEqual(options.method, "POST", "storage boundary check must stay read-only");
    const value = String(url);
    if (value.endsWith("/health")) return response(200, { status: "ok", service: "medical-calendar-api" });
    if (value.endsWith("/api/v2/meta")) {
      return response(200, {
        sales: "open",
        trials: "closed",
        universityTrials: { ugmu: "open" },
        paymentMode: "live",
      });
    }
    if (value.includes("/api/v2/catalog/ugmu/programs")) return response(404, { error: "catalog_not_available" });
    if (value.includes("/api/v2/schedules/ugmu/")) return response(404, { error: "schedule_not_published" });
    throw new Error(`Unexpected URL ${value}`);
  };
}

class FakeS3 {
  constructor(seed = new Map()) {
    this.objects = new Map(seed);
  }

  async send(command) {
    const name = command.constructor.name;
    const key = command.input.Key;
    if (name === "GetObjectCommand") {
      if (!this.objects.has(key)) {
        const error = new Error("NoSuchKey");
        error.name = "NoSuchKey";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      const value = this.objects.get(key);
      return {
        Body: { async transformToByteArray() { return Uint8Array.from(value.body); } },
        ContentType: value.contentType || "application/json; charset=utf-8",
        CacheControl: value.cacheControl || "no-store",
      };
    }
    if (name === "PutObjectCommand") {
      this.objects.set(key, {
        body: Buffer.from(command.input.Body),
        contentType: command.input.ContentType,
        cacheControl: command.input.CacheControl,
      });
      return {};
    }
    if (name === "DeleteObjectCommand") {
      this.objects.delete(key);
      return {};
    }
    throw new Error(`Unsupported command ${name}`);
  }
}

function streamForNumber(number) {
  if (number <= 112) return "1";
  if (number <= 124) return "2";
  if (number <= 136) return "3";
  return "4";
}

function eventCounts() {
  const values = [];
  for (const [, baseline] of Object.entries(EXPECTED_STREAMS)) {
    const count = baseline.groups;
    const base = Math.floor(baseline.events / count);
    const remainder = baseline.events - base * count;
    for (let index = 0; index < count; index += 1) values.push(base + (index < remainder ? 1 : 0));
  }
  assert.equal(values.length, 50);
  assert.equal(values.reduce((sum, value) => sum + value, 0), EXPECTED_EVENTS);
  return values;
}

function scheduleFixture(group, stream, eventCount) {
  const number = group.replace(/\D+/g, "");
  const sourceSha = EXPECTED_STREAMS[stream].sourceSha256;
  const versionId = `ver_ugmu_old${number}_preactivation_${sourceSha.slice(0, 12)}`;
  const event = (index) => ({
    schema_version: "1.0",
    system: { event_id: `evt_ugmu_old${number}_${String(index + 1).padStart(4, "0")}`, schedule_version_id: versionId },
    university: { code: "ugmu", name: "Уральский государственный медицинский университет" },
    academic: { academic_year: "2026/2027", semester: "autumn", faculty_code: "medicine", course: 1 },
    audience: { group, scope: "whole_group", subgroups: [], stream },
    timing: { date: "2026-09-01", start_time: "08:30", end_time: "10:00", all_day: false, time_mode: "floating" },
    lesson: { discipline: { raw: "Тест", normalized: "Тест" }, type: { raw: null, code: "other" }, teachers: [], locations: [], source_note: null, cycle_id: null, joint_groups: [] },
    source: { file_name: "source.pdf", file_hash: `sha256:${sourceSha}`, sheet: null, references: [{ role: "lesson", range: "test" }], raw_text: "Тест" },
    parse: { status: "ok", rule_ids: ["TEST"], warnings: [] },
    derived: {},
    calendar: { title: "Тест", description: "", location: "" },
  });
  return {
    schema_version: "1.0",
    schedule: {
      university_code: "ugmu",
      academic_year: "2026/2027",
      semester: "autumn",
      faculty_code: "medicine",
      course: 1,
      group,
      schedule_version_id: versionId,
    },
    events: Array.from({ length: eventCount }, (_, index) => event(index)),
  };
}

async function buildFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ugmu-course1-stage-"));
  const groupsDir = path.join(root, "groups");
  const counts = eventCounts();
  const groups = [];
  for (let index = 0; index < EXPECTED_GROUPS.length; index += 1) {
    const group = EXPECTED_GROUPS[index];
    const number = Number(group.replace(/\D+/g, ""));
    const stream = streamForNumber(number);
    const parsed = scheduleFixture(group, stream, counts[index]);
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    const groupId = `ugmu:medicine:1:stream-${stream}:${group}`;
    const storageKey = `schedules/ugmu/medicine/1/2026-2027/semester-1/${encodeURIComponent(groupId)}.json`;
    const rollbackKey = `rollback/ugmu/course1-preactivation/test-manifest/${encodeURIComponent(groupId)}.json`;
    const dir = path.join(groupsDir, `OLD-${number}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "schedule.json"), text);
    groups.push({
      group,
      stream,
      groupId,
      sourceSha256: EXPECTED_STREAMS[stream].sourceSha256,
      storageKey,
      rollback: { snapshotKey: rollbackKey },
      versionId: parsed.schedule.schedule_version_id,
      eventCount: parsed.events.length,
      uniqueEventIds: parsed.events.length,
      hashes: { scheduleSha256: sha256(text) },
      qa: { inputPublishable: true, outputPublishable: true },
    });
  }
  const manifest = {
    version: 1,
    kind: "ugmu-course1-preactivation-schedule-dry-run",
    manifestId: "test-manifest",
    scope: {
      program: "medicine", course: 1, streams: ["1", "2", "3", "4"], academicYear: "2026/2027", semester: 1,
      groups: EXPECTED_GROUPS,
      sourceSha256ByStream: Object.fromEntries(Object.entries(EXPECTED_STREAMS).map(([stream, item]) => [stream, item.sourceSha256])),
    },
    totals: {
      groups: 50,
      events: EXPECTED_EVENTS,
      streams: Object.fromEntries(Object.entries(EXPECTED_STREAMS).map(([stream, item]) => [stream, { groups: item.groups, events: item.events }])),
    },
    groups,
    safety: {
      dryRun: true, productionMutationPerformed: false, s3WritePerformed: false, cloudruMutationPerformed: false,
      registryActiveChanged: false, checkoutChanged: false, publicEndpointsChanged: false, trialsChanged: false, catalogChanged: false,
    },
    publicationAllowed: false,
    passed: true,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const authority = {
    version: 1,
    kind: "ugmu-course1-production-storage-staging-authority",
    manifestId: manifest.manifestId,
    manifestSha256: sha256(manifestText),
    sourceSha256ByStream: manifest.scope.sourceSha256ByStream,
    groups: EXPECTED_GROUPS,
    productionStorageWrite: true,
    registryMutation: false,
    catalogMutation: false,
    checkoutMutation: false,
    publicEndpointsMutation: false,
    publicIcsMutation: false,
    trialsMutation: false,
    canonicalPublicationWrite: false,
    salesActivation: false,
    commerceState: "preserve-current-production-state",
    scope: { university: "ugmu", program: "medicine", course: 1, streams: ["1", "2", "3", "4"], academicYear: "2026/2027", semester: 1 },
    credentialPath: "github-actions-s3-secrets",
  };
  return { root, groupsDir, manifest, manifestText, authority };
}

function stableBoundary() {
  return {
    passed: true,
    checks: { publicSchedulesClosed: true },
    runtimeState: { sales: "open", trials: "closed", ugmuTrials: "open", paymentMode: "live" },
  };
}

test("course-1 staging boundary probes all four streams read-only and accepts current global sales state", async () => {
  const result = await checkUgmuCourse1PublicBoundary("https://production.example", productionBoundaryFetch());
  assert.equal(result.passed, true);
  assert.equal(result.observed.schedules.length, 4);
  assert.deepEqual(result.observed.schedules.map((item) => item.stream), ["1", "2", "3", "4"]);
  assert.deepEqual(result.runtimeState, { sales: "open", trials: "closed", ugmuTrials: "open", paymentMode: "live" });
  assert.equal(result.observed.paymentProbePerformed, false);
});

test("course-1 authority is digest-bound and cannot mutate commerce/public product state", async () => {
  const fixture = await buildFixture();
  try {
    const digest = sha256(fixture.manifestText);
    assert.equal(Object.values(validateCourse1StagingAuthority(fixture.authority, fixture.manifest, digest)).every(Boolean), true);
    const unsafe = structuredClone(fixture.authority);
    unsafe.checkoutMutation = true;
    assert.throws(() => validateCourse1StagingAuthority(unsafe, fixture.manifest, digest), /authority is invalid/);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("course-1 approved schedule validates stream-specific source identity", () => {
  const group = "ОЛД 137";
  const stream = "4";
  const parsed = scheduleFixture(group, stream, 2);
  const item = {
    group, stream,
    groupId: "ugmu:medicine:1:stream-4:ОЛД 137",
    storageKey: `schedules/ugmu/medicine/1/2026-2027/semester-1/${encodeURIComponent("ugmu:medicine:1:stream-4:ОЛД 137")}.json`,
    versionId: parsed.schedule.schedule_version_id,
    eventCount: 2,
    uniqueEventIds: 2,
  };
  assert.equal(validateApprovedUgmuCourse1ScheduleObject(parsed, item).passed, true);
  parsed.events[0].source.file_hash = `sha256:${EXPECTED_STREAMS["3"].sourceSha256}`;
  assert.equal(validateApprovedUgmuCourse1ScheduleObject(parsed, item).passed, false);
});

test("course-1 staging writes all 50 schedules, snapshots prior state and is idempotent", async () => {
  const fixture = await buildFixture();
  const seed = new Map();
  for (const item of fixture.manifest.groups.slice(0, 12)) {
    seed.set(item.storageKey, { body: Buffer.from(`legacy-${item.group}`, "utf8") });
  }
  const s3 = new FakeS3(seed);
  const boundaryChecker = async () => stableBoundary();
  try {
    const first = await stageUgmuCourse1ProductionStorage({
      s3, bucket: "test", ...fixture, productionBaseUrl: "https://production.example", boundaryChecker,
      now: () => "2026-08-22T09:00:00.000Z",
    });
    assert.equal(first.passed, true);
    assert.equal(first.totals.groups, 50);
    assert.equal(first.totals.events, EXPECTED_EVENTS);
    assert.equal(first.totals.preexistingObjects, 12);
    assert.equal(first.totals.snapshotsCreated, 50);
    assert.equal(first.totals.schedulesWritten, 50);
    assert.equal(first.totals.alreadyStaged, 0);
    assert.equal(first.boundary.runtimeStatePreserved, true);
    assert.equal(fixture.manifest.groups.every((item) => s3.objects.has(item.rollback.snapshotKey)), true);

    const second = await stageUgmuCourse1ProductionStorage({
      s3, bucket: "test", ...fixture, productionBaseUrl: "https://production.example", boundaryChecker,
      now: () => "2026-08-22T09:05:00.000Z",
    });
    assert.equal(second.passed, true);
    assert.equal(second.totals.snapshotsCreated, 0);
    assert.equal(second.totals.schedulesWritten, 0);
    assert.equal(second.totals.alreadyStaged, 50);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("course-1 staging rolls back every touched target on an induced mid-run failure", async () => {
  const fixture = await buildFixture();
  const seed = new Map();
  for (const item of fixture.manifest.groups) seed.set(item.storageKey, { body: Buffer.from(`before-${item.group}`, "utf8") });
  const s3 = new FakeS3(seed);
  const boundaryChecker = async () => stableBoundary();
  try {
    await assert.rejects(
      stageUgmuCourse1ProductionStorage({
        s3, bucket: "test", ...fixture, productionBaseUrl: "https://production.example", boundaryChecker,
        now: () => "2026-08-22T09:10:00.000Z",
        beforeWrite: ({ index }) => { if (index === 20) throw new Error("induced-write-failure"); },
      }),
      (error) => {
        assert.match(error.message, /induced-write-failure/);
        assert.equal(error.rollbackPassed, true);
        assert.equal(error.rollback.length, 20);
        return true;
      },
    );
    for (const item of fixture.manifest.groups) {
      assert.equal(s3.objects.get(item.storageKey).body.toString("utf8"), `before-${item.group}`);
    }
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("course-1 staging rolls back when runtime commerce state changes during the storage write", async () => {
  const fixture = await buildFixture();
  const s3 = new FakeS3();
  let calls = 0;
  const boundaryChecker = async () => {
    calls += 1;
    const base = stableBoundary();
    if (calls === 2) base.runtimeState.ugmuTrials = "closed";
    return base;
  };
  try {
    await assert.rejects(
      stageUgmuCourse1ProductionStorage({
        s3, bucket: "test", ...fixture, productionBaseUrl: "https://production.example", boundaryChecker,
      }),
      (error) => {
        assert.match(error.message, /runtime commerce state changed/);
        assert.equal(error.rollbackPassed, true);
        assert.equal(error.rollback.length, 50);
        return true;
      },
    );
    assert.equal(fixture.manifest.groups.some((item) => s3.objects.has(item.storageKey)), false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("course-1 staging performs no writes when UGMU public boundary is unsafe", async () => {
  const fixture = await buildFixture();
  const s3 = new FakeS3();
  try {
    await assert.rejects(
      stageUgmuCourse1ProductionStorage({
        s3, bucket: "test", ...fixture, productionBaseUrl: "https://production.example",
        boundaryChecker: async () => ({ passed: false, checks: { publicSchedulesClosed: false }, runtimeState: stableBoundary().runtimeState }),
      }),
      /not safe before storage staging/,
    );
    assert.equal(s3.objects.size, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
