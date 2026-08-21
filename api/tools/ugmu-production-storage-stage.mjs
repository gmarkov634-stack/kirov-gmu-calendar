import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const EXPECTED_MANIFEST_ID = "ugmu-first-stream-34612248bba2";
const EXPECTED_MANIFEST_SHA256 = "2d8103b1c0a873c8cd52cc569426338342f2671ce0d740db6f3f0482590262e5";
const EXPECTED_SOURCE_SHA256 = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const EXPECTED_SOURCE_FILE_HASH = `sha256:${EXPECTED_SOURCE_SHA256}`;
const EXPECTED_GROUPS = Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`);
const EXPECTED_TOTAL_EVENTS = 4286;

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

async function bodyBuffer(response) {
  if (!response?.Body) return Buffer.alloc(0);
  if (typeof response.Body.transformToByteArray === "function") {
    return Buffer.from(await response.Body.transformToByteArray());
  }
  if (typeof response.Body.transformToString === "function") {
    return Buffer.from(await response.Body.transformToString("utf8"), "utf8");
  }
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readObject(s3, bucket, key) {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return {
      exists: true,
      body: await bodyBuffer(response),
      contentType: response.ContentType || "application/json; charset=utf-8",
      cacheControl: response.CacheControl || "no-store",
    };
  } catch (error) {
    if (isMissingObject(error)) return { exists: false, body: null, contentType: null, cacheControl: null };
    throw error;
  }
}

async function writeObject(s3, bucket, key, body, contentType = "application/json; charset=utf-8") {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "no-store",
  }));
}

async function removeObject(s3, bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

function absenceMarker({ manifestId, targetKey, capturedAt }) {
  return stableJson({
    version: 1,
    kind: "ugmu-preactivation-absence-marker",
    manifestId,
    targetKey,
    capturedAt,
  });
}

function snapshotKind(snapshot) {
  if (!snapshot?.exists) return "missing";
  try {
    const value = JSON.parse(snapshot.body.toString("utf8"));
    if (value?.kind === "ugmu-preactivation-absence-marker") return "absent";
  } catch {
    // A prior schedule object is valid opaque rollback bytes even if it is not JSON.
  }
  return "object";
}

function validateAuthority(authority, manifestDigest) {
  const checks = {
    kind: authority?.kind === "ugmu-production-storage-staging-authority",
    manifestId: authority?.manifestId === EXPECTED_MANIFEST_ID,
    manifestSha256: authority?.manifestSha256 === EXPECTED_MANIFEST_SHA256 && authority?.manifestSha256 === manifestDigest,
    sourceSha256: authority?.sourceSha256 === EXPECTED_SOURCE_SHA256,
    productionStorageWrite: authority?.productionStorageWrite === true,
    exactGroups: JSON.stringify(authority?.groups) === JSON.stringify(EXPECTED_GROUPS),
    checkoutClosed: authority?.checkoutEnabled === false,
    publicEndpointsClosed: authority?.publicEndpointsEnabled === false,
    publicIcsClosed: authority?.publicIcsEnabled === false,
    trialsClosed: authority?.trialsEnabled === false,
    catalogClosed: authority?.catalogEnabled === false,
    registryInactive: authority?.registryActive === false,
  };
  if (!Object.values(checks).every(Boolean)) {
    const error = new Error("UGMU production storage staging authority is invalid");
    error.checks = checks;
    throw error;
  }
  return checks;
}

function validateManifest(manifest, manifestDigest) {
  const checks = {
    digestPinned: manifestDigest === EXPECTED_MANIFEST_SHA256,
    manifestId: manifest?.manifestId === EXPECTED_MANIFEST_ID,
    passed: manifest?.passed === true,
    sourceSha256: manifest?.scope?.sourceSha256 === EXPECTED_SOURCE_SHA256,
    exactGroups: JSON.stringify(manifest?.scope?.groups) === JSON.stringify(EXPECTED_GROUPS),
    groupCount: manifest?.totals?.groups === 12,
    eventCount: manifest?.totals?.events === EXPECTED_TOTAL_EVENTS,
    dryRunOnly: manifest?.safety?.dryRun === true && manifest?.safety?.productionMutationPerformed === false,
    uniqueTargets: new Set((manifest?.groups || []).map((item) => item.storageKey)).size === 12,
    uniqueSnapshots: new Set((manifest?.groups || []).map((item) => item.rollback?.snapshotKey)).size === 12,
    qaApproved: (manifest?.groups || []).every((item) => item.qa?.inputPublishable === true && item.qa?.outputPublishable === true),
  };
  if (!Object.values(checks).every(Boolean)) {
    const error = new Error("UGMU production staging manifest does not match the approved dry-run");
    error.checks = checks;
    throw error;
  }
  return checks;
}

export function validateApprovedUgmuScheduleObject(parsed, item) {
  const expectedGroupId = `ugmu:medicine:1:stream-1:${item?.group || ""}`;
  const events = Array.isArray(parsed?.events) ? parsed.events : [];
  const checks = {
    schemaVersion: parsed?.schema_version === "1.0",
    university: parsed?.schedule?.university_code === "ugmu",
    faculty: parsed?.schedule?.faculty_code === "medicine",
    course: parsed?.schedule?.course === 1,
    academicYear: parsed?.schedule?.academic_year === "2026/2027",
    semester: parsed?.schedule?.semester === "autumn",
    group: parsed?.schedule?.group === item?.group,
    groupId: item?.groupId === expectedGroupId,
    version: parsed?.schedule?.schedule_version_id === item?.versionId,
    eventCount: events.length === item?.eventCount,
    eventUniversities: events.length > 0 && events.every((event) => event?.university?.code === "ugmu"),
    eventGroups: events.length > 0 && events.every((event) => event?.audience?.group === item?.group),
    eventAcademicScope: events.length > 0 && events.every((event) =>
      event?.academic?.faculty_code === "medicine" &&
      event?.academic?.course === 1 &&
      event?.academic?.academic_year === "2026/2027" &&
      event?.academic?.semester === "autumn"),
    eventSourceHash: events.length > 0 && events.every((event) => event?.source?.file_hash === EXPECTED_SOURCE_FILE_HASH),
    uniqueEventIds: new Set(events.map((event) => event?.system?.event_id).filter(Boolean)).size === item?.uniqueEventIds,
    versionOnEvents: events.length > 0 && events.every((event) => event?.system?.schedule_version_id === item?.versionId),
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

async function jsonResponse(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(15000) });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

export async function checkUgmuPublicBoundary(baseUrl, fetchImpl = fetch) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("Production base URL must be HTTPS");

  const health = await jsonResponse(fetchImpl, `${base}/health`);
  const meta = await jsonResponse(fetchImpl, `${base}/api/v2/meta`);
  const catalog = await jsonResponse(fetchImpl, `${base}/api/v2/catalog/ugmu/programs`);
  const encodedGroup = encodeURIComponent("ugmu:medicine:1:stream-1:ОЛД 101");
  const schedule = await jsonResponse(
    fetchImpl,
    `${base}/api/v2/schedules/ugmu/medicine/1/${encodedGroup}/schedule?groupCode=${encodeURIComponent("ОЛД 101")}&stream=1`,
  );
  const checkout = await jsonResponse(fetchImpl, `${base}/api/v2/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      university_id: "ugmu",
      program: "medicine",
      course: 1,
      stream: "1",
      groupCode: "ОЛД 101",
      groupId: "ugmu:medicine:1:stream-1:ОЛД 101",
      email: "storage-stage-smoke@example.com",
      plan: "semester",
    }),
  });

  const checks = {
    health: health.status === 200 && health.body?.status === "ok" && health.body?.service === "medical-calendar-api",
    salesClosed: meta.status === 200 && meta.body?.sales === "closed",
    trialsClosed: meta.status === 200 && meta.body?.trials === "closed",
    catalogClosed: catalog.status === 404 && ["catalog_not_available", "not_found"].includes(catalog.body?.error),
    publicScheduleClosed: schedule.status === 404 && ["schedule_not_published", "not_found"].includes(schedule.body?.error),
    checkoutClosed: checkout.status === 409 && checkout.body?.error === "sales_not_open",
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    observed: {
      catalog: { status: catalog.status, error: catalog.body?.error || null },
      schedule: { status: schedule.status, error: schedule.body?.error || null },
      checkout: { status: checkout.status, error: checkout.body?.error || null },
      paymentMode: meta.body?.paymentMode || null,
    },
  };
}

async function rollbackTouched({ s3, bucket, touched, capturedSnapshots }) {
  const results = [];
  for (const item of [...touched].reverse()) {
    const snapshot = capturedSnapshots.get(item.rollback.snapshotKey) || await readObject(s3, bucket, item.rollback.snapshotKey);
    const kind = snapshotKind(snapshot);
    if (kind === "absent") {
      await removeObject(s3, bucket, item.storageKey);
      const after = await readObject(s3, bucket, item.storageKey);
      results.push({ group: item.group, restored: !after.exists, mode: "delete-staged-object" });
      continue;
    }
    if (kind === "object") {
      await writeObject(s3, bucket, item.storageKey, snapshot.body, snapshot.contentType || "application/json; charset=utf-8");
      const after = await readObject(s3, bucket, item.storageKey);
      results.push({
        group: item.group,
        restored: after.exists && sha256(after.body) === sha256(snapshot.body),
        mode: "restore-snapshot",
      });
      continue;
    }
    results.push({ group: item.group, restored: false, mode: "snapshot-missing" });
  }
  return results;
}

export async function stageUgmuProductionStorage({
  s3,
  bucket,
  manifest,
  manifestText,
  authority,
  groupsDir,
  productionBaseUrl,
  boundaryChecker = checkUgmuPublicBoundary,
  now = () => new Date().toISOString(),
}) {
  if (!s3 || !bucket) throw new Error("Production S3 client/bucket is required");
  const manifestDigest = sha256(manifestText);
  const manifestChecks = validateManifest(manifest, manifestDigest);
  const authorityChecks = validateAuthority(authority, manifestDigest);

  const preBoundary = await boundaryChecker(productionBaseUrl);
  if (!preBoundary?.passed) {
    const error = new Error("UGMU public boundary is not fail-closed before storage staging");
    error.boundary = preBoundary;
    throw error;
  }

  const capturedSnapshots = new Map();
  const touched = [];
  const records = [];
  let snapshotsCreated = 0;
  let preexistingObjects = 0;
  let schedulesWritten = 0;
  let alreadyStaged = 0;

  try {
    for (const item of manifest.groups) {
      const number = String(item.group).replace(/\D+/g, "");
      const schedulePath = path.join(groupsDir, `OLD-${number}`, "schedule.json");
      const desiredBody = Buffer.from(await fs.readFile(schedulePath, "utf8"), "utf8");
      const desiredSha = sha256(desiredBody);
      if (desiredSha !== item.hashes?.scheduleSha256) throw new Error(`${item.group}: local schedule hash differs from manifest`);

      const parsed = JSON.parse(desiredBody.toString("utf8"));
      const scheduleValidation = validateApprovedUgmuScheduleObject(parsed, item);
      if (!scheduleValidation.passed) {
        const failed = Object.entries(scheduleValidation.checks).filter(([, value]) => !value).map(([key]) => key).join(", ");
        throw new Error(`${item.group}: approved schedule identity mismatch (${failed})`);
      }

      const before = await readObject(s3, bucket, item.storageKey);
      if (before.exists) preexistingObjects += 1;
      let snapshot = await readObject(s3, bucket, item.rollback.snapshotKey);
      if (!snapshot.exists) {
        if (before.exists) {
          await writeObject(s3, bucket, item.rollback.snapshotKey, before.body, before.contentType || "application/json; charset=utf-8");
        } else {
          await writeObject(
            s3,
            bucket,
            item.rollback.snapshotKey,
            absenceMarker({ manifestId: manifest.manifestId, targetKey: item.storageKey, capturedAt: now() }),
          );
        }
        snapshotsCreated += 1;
        snapshot = await readObject(s3, bucket, item.rollback.snapshotKey);
      }
      capturedSnapshots.set(item.rollback.snapshotKey, snapshot);

      const kind = snapshotKind(snapshot);
      if (kind === "object" && before.exists) {
        const beforeSha = sha256(before.body);
        const snapshotSha = sha256(snapshot.body);
        if (![desiredSha, snapshotSha].includes(beforeSha)) {
          throw new Error(`${item.group}: target drifted since rollback snapshot was captured`);
        }
      } else if (kind === "absent" && before.exists && sha256(before.body) !== desiredSha) {
        throw new Error(`${item.group}: target appeared after an absence snapshot and differs from approved schedule`);
      } else if (kind === "missing") {
        throw new Error(`${item.group}: rollback snapshot could not be captured`);
      }

      const beforeSha = before.exists ? sha256(before.body) : null;
      if (before.exists && beforeSha === desiredSha) {
        alreadyStaged += 1;
      } else {
        await writeObject(s3, bucket, item.storageKey, desiredBody);
        touched.push(item);
        schedulesWritten += 1;
      }

      const readBack = await readObject(s3, bucket, item.storageKey);
      const readBackSha = readBack.exists ? sha256(readBack.body) : null;
      if (!readBack.exists || readBackSha !== desiredSha) throw new Error(`${item.group}: read-back hash mismatch`);

      records.push({
        group: item.group,
        groupId: item.groupId,
        storageKey: item.storageKey,
        rollbackSnapshotKey: item.rollback.snapshotKey,
        rollbackMode: kind === "absent" ? "delete-staged-object" : "restore-snapshot",
        preexisting: before.exists,
        preStageSha256: beforeSha,
        desiredSha256: desiredSha,
        readBackSha256: readBackSha,
        written: !(before.exists && beforeSha === desiredSha),
        eventCount: item.eventCount,
      });
    }

    const postBoundary = await boundaryChecker(productionBaseUrl);
    if (!postBoundary?.passed) {
      const error = new Error("UGMU public boundary changed after storage staging");
      error.boundary = postBoundary;
      throw error;
    }

    const checks = {
      manifest: Object.values(manifestChecks).every(Boolean),
      authority: Object.values(authorityChecks).every(Boolean),
      preBoundary: preBoundary.passed === true,
      exactGroups: records.length === 12,
      exactEvents: records.reduce((sum, item) => sum + item.eventCount, 0) === EXPECTED_TOTAL_EVENTS,
      rollbackPrepared: records.every((item) => item.rollbackSnapshotKey),
      readBackVerified: records.every((item) => item.readBackSha256 === item.desiredSha256),
      postBoundary: postBoundary.passed === true,
      noCanonicalPublicationWrite: true,
      noPublicIcsWrite: true,
    };

    return {
      version: 1,
      kind: "ugmu-production-storage-staging-report",
      status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      manifestId: manifest.manifestId,
      manifestSha256: manifestDigest,
      sourceSha256: EXPECTED_SOURCE_SHA256,
      stagedAt: now(),
      bucket,
      totals: {
        groups: records.length,
        events: records.reduce((sum, item) => sum + item.eventCount, 0),
        snapshotsCreated,
        preexistingObjects,
        schedulesWritten,
        alreadyStaged,
        readBackVerified: records.filter((item) => item.readBackSha256 === item.desiredSha256).length,
      },
      groups: records,
      boundaries: { before: preBoundary, after: postBoundary },
      checks,
      safety: {
        productionMutationPerformed: snapshotsCreated > 0 || schedulesWritten > 0,
        scheduleObjectsStaged: records.length,
        rollbackSnapshotsRetained: true,
        canonicalPublicationObjectsWritten: false,
        publicIcsWritten: false,
        registryActiveChanged: false,
        checkoutChanged: false,
        publicEndpointsChanged: false,
        trialsChanged: false,
        catalogChanged: false,
      },
      nextRequiredBoundary: "deploy-isolation-guards",
      passed: Object.values(checks).every(Boolean),
    };
  } catch (error) {
    const rollback = await rollbackTouched({ s3, bucket, touched, capturedSnapshots });
    error.rollback = rollback;
    error.rollbackPassed = rollback.every((item) => item.restored === true);
    throw error;
  }
}

async function main() {
  const manifestPath = path.resolve(arg("manifest", "data/imports/ugmu-preactivation-dry-run/manifest.json"));
  const groupsDir = path.resolve(arg("groups-dir", "data/imports/ugmu-preactivation-dry-run/groups"));
  const authorityPath = path.resolve(arg("authority", "../universities/ugmu/production-staging-authority.json"));
  const reportPath = path.resolve(arg("report", "data/imports/ugmu-production-storage-stage/report.json"));
  const productionBaseUrl = arg("production-base-url", "https://kgmu-calendar-api.containerapps.ru");
  const confirm = arg("confirm", "");
  if (confirm !== EXPECTED_MANIFEST_ID || process.env.PRODUCTION_STORAGE_STAGE_ALLOWED !== "true") {
    throw new Error("UGMU production storage staging requires the exact explicit step-23 confirmation");
  }

  const manifestText = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const authority = JSON.parse(await fs.readFile(authorityPath, "utf8"));
  const bucket = process.env.S3_BUCKET || "kgmu-calendar-data-gmarkov634";
  const endpoint = process.env.S3_ENDPOINT || "https://s3.cloud.ru";
  const region = process.env.S3_REGION || "ru-central-1";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";
  if (!accessKeyId || !secretAccessKey) throw new Error("Production S3 credentials are unavailable");

  const s3 = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  try {
    const report = await stageUgmuProductionStorage({
      s3,
      bucket,
      manifest,
      manifestText,
      authority,
      groupsDir,
      productionBaseUrl,
    });
    await fs.writeFile(reportPath, stableJson(report), "utf8");
    console.log(`UGMU production storage staging: ${report.passed ? "PASS" : "FAIL"}`);
    console.log(`Groups: ${report.totals.groups}; events: ${report.totals.events}`);
    console.log(`Schedule writes: ${report.totals.schedulesWritten}; already staged: ${report.totals.alreadyStaged}`);
    console.log(`Rollback snapshots created: ${report.totals.snapshotsCreated}`);
    console.log(`Read-back verified: ${report.totals.readBackVerified}/12`);
    console.log(`Next boundary: ${report.nextRequiredBoundary}`);
    if (!report.passed) process.exitCode = 2;
  } catch (error) {
    const failure = {
      version: 1,
      kind: "ugmu-production-storage-staging-report",
      status: "FAIL",
      manifestId: manifest?.manifestId || null,
      manifestSha256: sha256(manifestText),
      failedAt: new Date().toISOString(),
      error: String(error?.message || error),
      checks: error?.checks || null,
      boundary: error?.boundary || null,
      rollback: error?.rollback || [],
      rollbackPassed: error?.rollbackPassed ?? null,
      passed: false,
    };
    await fs.writeFile(reportPath, stableJson(failure), "utf8");
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
