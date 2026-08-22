import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const EXPECTED_GROUPS = Array.from({ length: 50 }, (_, index) => `ОЛД ${101 + index}`);
const EXPECTED_EVENTS = 17301;
const EXPECTED_STREAMS = {
  "1": { groups: 12, events: 4286, sourceSha256: "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8" },
  "2": { groups: 12, events: 4263, sourceSha256: "722300a869f7ecb2939aaa240463ca7b8d6c566c60a98ae90181d67d2c7e44ca" },
  "3": { groups: 12, events: 4026, sourceSha256: "248f436baa3254ee891506628b05e945bddfbb708616ec5e38b34e7d893783ca" },
  "4": { groups: 14, events: 4726, sourceSha256: "5fa092b9eac42190cf06a927f30d4b6442a5c159bea94f95da484c44b050e90d" },
};

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
  if (typeof response.Body.transformToByteArray === "function") return Buffer.from(await response.Body.transformToByteArray());
  if (typeof response.Body.transformToString === "function") return Buffer.from(await response.Body.transformToString("utf8"), "utf8");
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
    kind: "ugmu-course1-preactivation-absence-marker",
    manifestId,
    targetKey,
    capturedAt,
  });
}

function snapshotKind(snapshot) {
  if (!snapshot?.exists) return "missing";
  try {
    const value = JSON.parse(snapshot.body.toString("utf8"));
    if (value?.kind === "ugmu-course1-preactivation-absence-marker") return "absent";
  } catch {
    // Prior production bytes are intentionally opaque rollback material.
  }
  return "object";
}

function exactStreamSources(value) {
  return Object.keys(EXPECTED_STREAMS).every((stream) => value?.[stream] === EXPECTED_STREAMS[stream].sourceSha256)
    && Object.keys(value || {}).length === 4;
}

function validateManifest(manifest, manifestDigest) {
  const checks = {
    kind: manifest?.kind === "ugmu-course1-preactivation-schedule-dry-run",
    passed: manifest?.passed === true,
    publicationClosed: manifest?.publicationAllowed === false,
    exactGroups: JSON.stringify(manifest?.scope?.groups) === JSON.stringify(EXPECTED_GROUPS),
    exactStreams: JSON.stringify(manifest?.scope?.streams) === JSON.stringify(["1", "2", "3", "4"]),
    exactSources: exactStreamSources(manifest?.scope?.sourceSha256ByStream),
    groupCount: manifest?.totals?.groups === 50,
    eventCount: manifest?.totals?.events === EXPECTED_EVENTS,
    exactStreamCounts: Object.entries(EXPECTED_STREAMS).every(([stream, expected]) =>
      manifest?.totals?.streams?.[stream]?.groups === expected.groups &&
      manifest?.totals?.streams?.[stream]?.events === expected.events),
    dryRunOnly: manifest?.safety?.dryRun === true && manifest?.safety?.productionMutationPerformed === false,
    noS3Write: manifest?.safety?.s3WritePerformed === false,
    noCloudMutation: manifest?.safety?.cloudruMutationPerformed === false,
    catalogUnchanged: manifest?.safety?.catalogChanged === false,
    trialsUnchanged: manifest?.safety?.trialsChanged === false,
    checkoutUnchanged: manifest?.safety?.checkoutChanged === false,
    uniqueTargets: new Set((manifest?.groups || []).map((item) => item.storageKey)).size === 50,
    uniqueSnapshots: new Set((manifest?.groups || []).map((item) => item.rollback?.snapshotKey)).size === 50,
    qaApproved: (manifest?.groups || []).length === 50 && (manifest?.groups || []).every((item) => item.qa?.inputPublishable && item.qa?.outputPublishable),
    digestShape: /^[a-f0-9]{64}$/.test(manifestDigest),
  };
  if (!Object.values(checks).every(Boolean)) {
    const error = new Error("UGMU course-1 staging manifest is not approved fail-closed evidence");
    error.checks = checks;
    throw error;
  }
  return checks;
}

export function validateCourse1StagingAuthority(authority, manifest, manifestDigest) {
  const checks = {
    version: authority?.version === 1,
    kind: authority?.kind === "ugmu-course1-production-storage-staging-authority",
    manifestId: authority?.manifestId === manifest?.manifestId,
    manifestSha256: authority?.manifestSha256 === manifestDigest,
    exactSources: exactStreamSources(authority?.sourceSha256ByStream),
    exactGroups: JSON.stringify(authority?.groups) === JSON.stringify(EXPECTED_GROUPS),
    productionStorageWrite: authority?.productionStorageWrite === true,
    registryMutationBlocked: authority?.registryMutation === false,
    catalogMutationBlocked: authority?.catalogMutation === false,
    checkoutMutationBlocked: authority?.checkoutMutation === false,
    publicEndpointsMutationBlocked: authority?.publicEndpointsMutation === false,
    publicIcsMutationBlocked: authority?.publicIcsMutation === false,
    trialsMutationBlocked: authority?.trialsMutation === false,
    canonicalPublicationMutationBlocked: authority?.canonicalPublicationWrite === false,
    salesMutationBlocked: authority?.salesActivation === false,
    commerceStatePreserved: authority?.commerceState === "preserve-current-production-state",
    scope: authority?.scope?.university === "ugmu"
      && authority?.scope?.program === "medicine"
      && authority?.scope?.course === 1
      && JSON.stringify(authority?.scope?.streams) === JSON.stringify(["1", "2", "3", "4"])
      && authority?.scope?.academicYear === "2026/2027"
      && authority?.scope?.semester === 1,
    credentialPath: authority?.credentialPath === "cloudru-runtime-container-env",
  };
  if (!Object.values(checks).every(Boolean)) {
    const error = new Error("UGMU course-1 production storage staging authority is invalid");
    error.checks = checks;
    throw error;
  }
  return checks;
}

export function validateApprovedUgmuCourse1ScheduleObject(parsed, item) {
  const stream = String(item?.stream || "");
  const expectedSource = EXPECTED_STREAMS[stream]?.sourceSha256;
  const expectedGroupId = `ugmu:medicine:1:stream-${stream}:${item?.group || ""}`;
  const expectedStoragePrefix = "schedules/ugmu/medicine/1/2026-2027/semester-1/";
  const events = Array.isArray(parsed?.events) ? parsed.events : [];
  const checks = {
    supportedStream: Boolean(expectedSource),
    schemaVersion: parsed?.schema_version === "1.0",
    university: parsed?.schedule?.university_code === "ugmu",
    faculty: parsed?.schedule?.faculty_code === "medicine",
    course: parsed?.schedule?.course === 1,
    academicYear: parsed?.schedule?.academic_year === "2026/2027",
    semester: parsed?.schedule?.semester === "autumn",
    group: parsed?.schedule?.group === item?.group,
    groupId: item?.groupId === expectedGroupId,
    storageNamespace: String(item?.storageKey || "").startsWith(expectedStoragePrefix),
    version: parsed?.schedule?.schedule_version_id === item?.versionId,
    eventCount: events.length === item?.eventCount,
    eventUniversities: events.length > 0 && events.every((event) => event?.university?.code === "ugmu"),
    eventGroups: events.length > 0 && events.every((event) => event?.audience?.group === item?.group),
    eventStreams: events.length > 0 && events.every((event) => String(event?.audience?.stream) === stream),
    eventAcademicScope: events.length > 0 && events.every((event) =>
      event?.academic?.faculty_code === "medicine" && event?.academic?.course === 1 &&
      event?.academic?.academic_year === "2026/2027" && event?.academic?.semester === "autumn"),
    eventSourceHash: events.length > 0 && events.every((event) => event?.source?.file_hash === `sha256:${expectedSource}`),
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

function runtimeState(meta) {
  return {
    sales: meta?.body?.sales ?? null,
    trials: meta?.body?.trials ?? null,
    ugmuTrials: meta?.body?.universityTrials?.ugmu ?? null,
    paymentMode: meta?.body?.paymentMode ?? null,
  };
}

export async function checkUgmuCourse1PublicBoundary(baseUrl, fetchImpl = fetch) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("Production base URL must be HTTPS");
  const representatives = [
    { stream: "1", group: "ОЛД 101" },
    { stream: "2", group: "ОЛД 113" },
    { stream: "3", group: "ОЛД 125" },
    { stream: "4", group: "ОЛД 137" },
  ];

  const health = await jsonResponse(fetchImpl, `${base}/health`);
  const meta = await jsonResponse(fetchImpl, `${base}/api/v2/meta`);
  const catalog = await jsonResponse(fetchImpl, `${base}/api/v2/catalog/ugmu/programs`);
  const schedules = [];
  for (const rep of representatives) {
    const groupId = encodeURIComponent(`ugmu:medicine:1:stream-${rep.stream}:${rep.group}`);
    schedules.push(await jsonResponse(
      fetchImpl,
      `${base}/api/v2/schedules/ugmu/medicine/1/${groupId}/schedule?groupCode=${encodeURIComponent(rep.group)}&stream=${rep.stream}`,
    ));
  }

  const state = runtimeState(meta);
  const checks = {
    health: health.status === 200 && health.body?.status === "ok" && health.body?.service === "medical-calendar-api",
    metaReadable: meta.status === 200,
    currentProductionModeRecognized: ["open", "closed"].includes(state.sales)
      && ["open", "closed"].includes(state.trials)
      && ["live", "test"].includes(state.paymentMode),
    catalogClosed: catalog.status === 404 && ["catalog_not_available", "not_found"].includes(catalog.body?.error),
    publicSchedulesClosed: schedules.every((response) => response.status === 404 && ["schedule_not_published", "not_found"].includes(response.body?.error)),
    readOnly: true,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    runtimeState: state,
    observed: {
      catalog: { status: catalog.status, error: catalog.body?.error || null },
      schedules: schedules.map((response, index) => ({ ...representatives[index], status: response.status, error: response.body?.error || null })),
      runtimeState: state,
      paymentProbePerformed: false,
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
    } else if (kind === "object") {
      await writeObject(s3, bucket, item.storageKey, snapshot.body, snapshot.contentType || "application/json; charset=utf-8");
      const after = await readObject(s3, bucket, item.storageKey);
      results.push({ group: item.group, restored: after.exists && sha256(after.body) === sha256(snapshot.body), mode: "restore-snapshot" });
    } else {
      results.push({ group: item.group, restored: false, mode: "snapshot-missing" });
    }
  }
  return results;
}

export async function stageUgmuCourse1ProductionStorage({
  s3,
  bucket,
  manifest,
  manifestText,
  authority,
  groupsDir,
  productionBaseUrl,
  boundaryChecker = checkUgmuCourse1PublicBoundary,
  now = () => new Date().toISOString(),
  beforeWrite = null,
}) {
  if (!s3 || !bucket) throw new Error("Production S3 client/bucket is required");
  const manifestDigest = sha256(manifestText);
  const manifestChecks = validateManifest(manifest, manifestDigest);
  const authorityChecks = validateCourse1StagingAuthority(authority, manifest, manifestDigest);
  const preBoundary = await boundaryChecker(productionBaseUrl);
  if (!preBoundary?.passed) {
    const error = new Error("UGMU course-1 public boundary is not safe before storage staging");
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
      const validation = validateApprovedUgmuCourse1ScheduleObject(parsed, item);
      if (!validation.passed) {
        const failed = Object.entries(validation.checks).filter(([, value]) => !value).map(([key]) => key).join(", ");
        throw new Error(`${item.group}: approved schedule identity mismatch (${failed})`);
      }

      const before = await readObject(s3, bucket, item.storageKey);
      if (before.exists) preexistingObjects += 1;
      let snapshot = await readObject(s3, bucket, item.rollback.snapshotKey);
      if (!snapshot.exists) {
        if (before.exists) {
          await writeObject(s3, bucket, item.rollback.snapshotKey, before.body, before.contentType || "application/json; charset=utf-8");
        } else {
          await writeObject(s3, bucket, item.rollback.snapshotKey, absenceMarker({ manifestId: manifest.manifestId, targetKey: item.storageKey, capturedAt: now() }));
        }
        snapshotsCreated += 1;
        snapshot = await readObject(s3, bucket, item.rollback.snapshotKey);
      }
      capturedSnapshots.set(item.rollback.snapshotKey, snapshot);

      const kind = snapshotKind(snapshot);
      const beforeSha = before.exists ? sha256(before.body) : null;
      if (kind === "object" && before.exists) {
        const snapshotSha = sha256(snapshot.body);
        if (![desiredSha, snapshotSha].includes(beforeSha)) throw new Error(`${item.group}: target drifted since rollback snapshot was captured`);
      } else if (kind === "absent" && before.exists && beforeSha !== desiredSha) {
        throw new Error(`${item.group}: target appeared after absence snapshot and differs from approved schedule`);
      } else if (kind === "missing") {
        throw new Error(`${item.group}: rollback snapshot could not be captured`);
      }

      if (before.exists && beforeSha === desiredSha) {
        alreadyStaged += 1;
      } else {
        if (beforeWrite) await beforeWrite({ item, index: records.length, desiredBody });
        await writeObject(s3, bucket, item.storageKey, desiredBody);
        touched.push(item);
        schedulesWritten += 1;
      }

      const readBack = await readObject(s3, bucket, item.storageKey);
      const readBackSha = readBack.exists ? sha256(readBack.body) : null;
      if (!readBack.exists || readBackSha !== desiredSha) throw new Error(`${item.group}: staged schedule failed read-back verification`);
      records.push({
        group: item.group,
        stream: item.stream,
        storageKey: item.storageKey,
        rollbackSnapshotKey: item.rollback.snapshotKey,
        rollbackSnapshotKind: kind,
        desiredSha256: desiredSha,
        readBackSha256: readBackSha,
        preexisting: before.exists,
        writePerformed: !(before.exists && beforeSha === desiredSha),
      });
    }

    const postBoundary = await boundaryChecker(productionBaseUrl);
    if (!postBoundary?.passed) {
      const error = new Error("UGMU course-1 public boundary became unsafe during storage staging");
      error.boundary = postBoundary;
      throw error;
    }
    const runtimeStatePreserved = JSON.stringify(preBoundary.runtimeState ?? null) === JSON.stringify(postBoundary.runtimeState ?? null);
    if (!runtimeStatePreserved) {
      const error = new Error("UGMU course-1 runtime commerce state changed during storage staging");
      error.boundary = { before: preBoundary, after: postBoundary };
      throw error;
    }

    const totals = {
      groups: records.length,
      events: manifest.groups.reduce((sum, item) => sum + item.eventCount, 0),
      snapshotsCreated,
      preexistingObjects,
      schedulesWritten,
      alreadyStaged,
    };
    const passed = records.length === 50 && totals.events === EXPECTED_EVENTS
      && records.every((record) => record.desiredSha256 === record.readBackSha256)
      && preBoundary.passed && postBoundary.passed && runtimeStatePreserved;
    return {
      version: 2,
      kind: "ugmu-course1-production-storage-stage-report",
      status: passed ? "PASS" : "FAIL",
      mode: "production-storage-stage-only",
      stagedAt: now(),
      manifestId: manifest.manifestId,
      manifestSha256: manifestDigest,
      bucket,
      totals,
      groups: records,
      manifestChecks,
      authorityChecks,
      boundary: { before: preBoundary, after: postBoundary, runtimeStatePreserved },
      rollbackPerformed: false,
      productionStorageWritePerformed: schedulesWritten > 0,
      registryChanged: false,
      catalogChanged: false,
      trialsChanged: false,
      checkoutChanged: false,
      salesActivationPerformed: false,
      publicationAllowed: false,
      nextRequiredBoundary: passed ? "course1-production-storage-readback" : "course1-production-storage-recovery",
      passed,
    };
  } catch (error) {
    const rollback = await rollbackTouched({ s3, bucket, touched, capturedSnapshots });
    error.rollback = rollback;
    error.rollbackPassed = rollback.every((item) => item.restored);
    throw error;
  }
}

async function main() {
  const manifestPath = path.resolve(arg("manifest", "data/imports/ugmu-course1/preactivation-dry-run/manifest.json"));
  const authorityPath = path.resolve(arg("authority", "../universities/ugmu/course1-production-staging-authority.json"));
  const groupsDir = path.resolve(arg("groups-dir", "data/imports/ugmu-course1/preactivation-dry-run/groups"));
  const reportPath = path.resolve(arg("report", "data/imports/ugmu-course1/production-storage-stage/report.json"));
  const productionBaseUrl = arg("production-base-url", "https://kgmu-calendar-api.containerapps.ru");
  const manifestText = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const authority = JSON.parse(await fs.readFile(authorityPath, "utf8"));
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";
  if (!accessKeyId || !secretAccessKey) throw new Error("Production S3 credentials are unavailable");
  const bucket = process.env.S3_BUCKET || "kgmu-calendar-data-gmarkov634";
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT || "https://s3.cloud.ru",
    region: process.env.S3_REGION || "ru-central-1",
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const report = await stageUgmuCourse1ProductionStorage({ s3, bucket, manifest, manifestText, authority, groupsDir, productionBaseUrl });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, stableJson(report));
  console.log(`UGMU course-1 production storage stage: ${report.status}`);
  console.log(`Groups: ${report.totals.groups}/50; events: ${report.totals.events}/${EXPECTED_EVENTS}`);
  console.log(`Writes: ${report.totals.schedulesWritten}; already staged: ${report.totals.alreadyStaged}; snapshots created: ${report.totals.snapshotsCreated}`);
  console.log("Catalog/trials/checkout/sales state: preserved; no activation mutation");
  if (!report.passed) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error);
    if (error?.checks) console.error(JSON.stringify(error.checks, null, 2));
    if (error?.boundary) console.error(JSON.stringify(error.boundary, null, 2));
    if (error?.rollback) console.error(JSON.stringify({ rollback: error.rollback, rollbackPassed: error.rollbackPassed }, null, 2));
    process.exitCode = 1;
  });
}

export const COURSE1_STORAGE_STAGE_ALLOWED = true;
export { EXPECTED_GROUPS, EXPECTED_EVENTS, EXPECTED_STREAMS };
