import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const EXPECTED_GROUPS = Array.from({ length: 48 }, (_, index) => `ОЛД ${201 + index}`);
const EXPECTED_EVENTS = 11056;
const EXPECTED_STREAMS = {
  "1": { first: 201, last: 212, groups: 12, events: 2788, sourceSha256: "8b81f37b517dd037c090b0d980ba4d916557f36c872fe0fc37031d4ae8808c6a" },
  "2": { first: 213, last: 224, groups: 12, events: 2779, sourceSha256: "07675a77bdb80080ea018a73750f00f458cc100fcd01a63ecaf142430bca94bd" },
  "3": { first: 225, last: 236, groups: 12, events: 2742, sourceSha256: "b6cc586f29a20bd008b5da89129809db7fbed8b2a9224a9f2d4cd3e3a77a9b85" },
  "4": { first: 237, last: 248, groups: 12, events: 2747, sourceSha256: "6b5f87dc7f565169105245a397996e61e94794dfe580529cc5f7398a62e21517" },
};
const SOURCE_RUN_ID = 32601092056;
const SOURCE_HEAD_SHA = "44fd85214f5397ee7b2923d8d88ee6219c88e2f5";
const SOURCE_ARTIFACT_DIGEST = "sha256:de59e655cd5ee161c6b35b4ae9cc5d9400fcb834fbf8f398ffea45e6f362e42a";
const STORAGE_PLAN_SHA256 = "783dba66f9cf48ae47a335c9cb4c9a7a41121d2a7d008b67262b910e8db38c2e";
const AUTHORITY_SHA256 = "3fb2c9c90bc9a8e9cec69a94578f220f5d348d19e8deaf3670c5ca724c5a38fd";
const CONFIRM_PHRASE = "STAGE UGMU COURSE2 OLD 201-248 11056";

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
  return error?.name === "NotFound"
    || error?.name === "NoSuchKey"
    || error?.Code === "NoSuchKey"
    || error?.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailure(error) {
  return error?.name === "PreconditionFailed"
    || error?.Code === "PreconditionFailed"
    || error?.$metadata?.httpStatusCode === 412;
}

async function bodyBuffer(response) {
  if (!response?.Body) return Buffer.alloc(0);
  if (typeof response.Body.transformToByteArray === "function") return Buffer.from(await response.Body.transformToByteArray());
  if (typeof response.Body.transformToString === "function") return Buffer.from(await response.Body.transformToString("utf8"), "utf8");
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function headObject(s3, bucket, key) {
  try {
    const response = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { exists: true, contentLength: Number(response.ContentLength || 0), etag: response.ETag || null };
  } catch (error) {
    if (isMissingObject(error)) return { exists: false, contentLength: 0, etag: null };
    throw error;
  }
}

async function getObject(s3, bucket, key) {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return { exists: true, body: await bodyBuffer(response) };
  } catch (error) {
    if (isMissingObject(error)) return { exists: false, body: null };
    throw error;
  }
}

async function createObjectOnly(s3, bucket, key, body) {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
      IfNoneMatch: "*",
    }));
  } catch (error) {
    if (isPreconditionFailure(error)) {
      const wrapped = new Error(`Target became occupied before conditional create: ${key}`);
      wrapped.code = "TARGET_OCCUPIED";
      throw wrapped;
    }
    throw error;
  }
}

async function deleteObject(s3, bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

function requireAuthority(authority, authorityText) {
  const digest = sha256(authorityText);
  const checks = {
    digest: digest === AUTHORITY_SHA256,
    version: authority?.version === 1,
    kind: authority?.kind === "ugmu-course2-production-storage-staging-authority",
    scope: authority?.scope?.university === "ugmu"
      && authority?.scope?.program === "medicine"
      && authority?.scope?.course === 2
      && JSON.stringify(authority?.scope?.streams) === JSON.stringify(["1", "2", "3", "4"])
      && authority?.scope?.academicYear === "2026/2027"
      && authority?.scope?.semester === 1
      && JSON.stringify(authority?.scope?.groups) === JSON.stringify(EXPECTED_GROUPS),
    sourceReview: authority?.sourceReview?.runId === SOURCE_RUN_ID
      && authority?.sourceReview?.headSha === SOURCE_HEAD_SHA
      && authority?.sourceReview?.artifactDigest === SOURCE_ARTIFACT_DIGEST
      && authority?.sourceReview?.aggregateStoragePlanSha256 === STORAGE_PLAN_SHA256
      && authority?.sourceReview?.groups === 48
      && authority?.sourceReview?.events === EXPECTED_EVENTS,
    collisionAudit: authority?.collisionAudit?.course1Present === 50
      && authority?.collisionAudit?.course1HashesMatched === 50
      && authority?.collisionAudit?.course2TargetsFree === 48
      && authority?.collisionAudit?.course2TargetsOccupied === 0
      && authority?.collisionAudit?.course1Course2KeyCollisions === 0
      && authority?.collisionAudit?.crossUniversityTargets === 0,
    exactStreams: Object.entries(EXPECTED_STREAMS).every(([stream, expected]) => {
      const actual = authority?.streams?.[stream];
      return actual?.first === expected.first && actual?.last === expected.last
        && actual?.groups === expected.groups && actual?.events === expected.events
        && actual?.sourceSha256 === expected.sourceSha256;
    }),
    writeAuthorized: authority?.productionStorageWrite === true,
    targetAbsenceRequired: authority?.requireTargetsAbsentAtWrite === true,
    conditionalCreateOnly: authority?.conditionalCreateOnly === true,
    rollbackRequired: authority?.rollbackOnPartialFailure === true,
    registryBlocked: authority?.registryMutation === false,
    catalogBlocked: authority?.catalogMutation === false,
    checkoutBlocked: authority?.checkoutMutation === false,
    accessBlocked: authority?.accessPolicyMutation === false,
    publicEndpointsBlocked: authority?.publicEndpointsMutation === false,
    publicIcsBlocked: authority?.publicIcsMutation === false,
    trialsBlocked: authority?.trialsMutation === false,
    canonicalPublicationBlocked: authority?.canonicalPublicationWrite === false,
    salesBlocked: authority?.salesActivation === false,
    commercePreserved: authority?.commerceState === "preserve-current-production-state",
    credentialPath: authority?.credentialPath === "github-actions-protected-s3-secrets",
  };
  if (!Object.values(checks).every(Boolean)) {
    const error = new Error("UGMU course-2 production staging authority is invalid");
    error.checks = checks;
    throw error;
  }
  return { checks, digest };
}

function requireConfirmation(confirmation, authorityDigest) {
  const checks = {
    version: confirmation?.version === 1,
    kind: confirmation?.kind === "ugmu-course2-production-storage-stage-confirmation",
    phrase: confirmation?.phrase === CONFIRM_PHRASE,
    authoritySha256: confirmation?.authoritySha256 === authorityDigest,
    explicitProductionStorageWrite: confirmation?.explicitProductionStorageWrite === true,
    scope: confirmation?.scope?.university === "ugmu"
      && confirmation?.scope?.program === "medicine"
      && confirmation?.scope?.course === 2
      && JSON.stringify(confirmation?.scope?.groups) === JSON.stringify(EXPECTED_GROUPS),
    noCatalogMutation: confirmation?.catalogMutation === false,
    noAccessMutation: confirmation?.accessPolicyMutation === false,
    noSalesMutation: confirmation?.salesActivation === false,
    noPublicIcsMutation: confirmation?.publicIcsMutation === false,
  };
  if (!Object.values(checks).every(Boolean)) {
    const error = new Error("Explicit UGMU course-2 production storage confirmation is invalid");
    error.checks = checks;
    throw error;
  }
  return checks;
}

function requirePreactivationReport(report) {
  const checks = {
    stage: report?.stage === "ics-preactivation-dry-run",
    scope: report?.university === "ugmu" && report?.program === "medicine" && report?.course === 2,
    groupCount: report?.summary?.groupCount === 48,
    eventCount: report?.summary?.eventCount === EXPECTED_EVENTS,
    storageTargets: report?.summary?.storageTargetCount === 48,
    plan: report?.summary?.aggregateStoragePlanSha256 === STORAGE_PLAN_SHA256,
    qa: report?.summary?.inputQaPassedGroups === 48 && report?.summary?.outputQaPassedGroups === 48,
    identities: report?.summary?.uniqueEventIdCount === EXPECTED_EVENTS && report?.summary?.uniqueUidCount === EXPECTED_EVENTS,
    noPriorWrite: report?.summary?.productionStoreCalls === 0 && report?.summary?.storageWritesPerformed === false,
    noPublication: report?.summary?.publicationAllowed === false && report?.summary?.publicIcsPublicationPerformed === false,
    ready: report?.summary?.preactivationReady === true && report?.summary?.reviewRequired === false,
    groups: Object.keys(report?.groups || {}).length === 48,
  };
  if (!Object.values(checks).every(Boolean)) {
    const error = new Error("UGMU course-2 preactivation report is invalid for production staging");
    error.checks = checks;
    throw error;
  }
  return checks;
}

function streamForGroup(group) {
  const number = Number(String(group).match(/\d+/)?.[0]);
  for (const [stream, expected] of Object.entries(EXPECTED_STREAMS)) {
    if (number >= expected.first && number <= expected.last) return stream;
  }
  return null;
}

function validateBatch(batch, group, item) {
  const stream = streamForGroup(group);
  const expected = EXPECTED_STREAMS[stream];
  const events = Array.isArray(batch?.events) ? batch.events : [];
  const expectedGroupId = `ugmu:medicine:2:stream-${stream}:${group}`;
  const expectedStoragePrefix = "schedules/ugmu/medicine/2/2026-2027/semester-1/";
  const eventIds = events.map((event) => event?.system?.event_id).filter(Boolean);
  const checks = {
    supportedStream: Boolean(expected),
    schema: batch?.schema_version === "1.0",
    scheduleScope: batch?.schedule?.university_code === "ugmu"
      && batch?.schedule?.faculty_code === "medicine"
      && batch?.schedule?.course === 2
      && batch?.schedule?.academic_year === "2026/2027"
      && batch?.schedule?.semester === "autumn"
      && batch?.schedule?.group === group,
    groupId: item?.groupId === expectedGroupId,
    storageKey: String(item?.storageKey || "").startsWith(expectedStoragePrefix)
      && item.storageKey.endsWith(`${encodeURIComponent(expectedGroupId)}.json`),
    version: batch?.schedule?.schedule_version_id === item?.scheduleVersionId,
    fingerprint: batch?.schedule?.content_fingerprint === item?.contentFingerprint,
    eventCount: events.length === item?.eventCount && events.length > 0,
    eventUniversity: events.every((event) => event?.university?.code === "ugmu"),
    eventAcademic: events.every((event) => event?.academic?.faculty_code === "medicine"
      && event?.academic?.course === 2
      && event?.academic?.academic_year === "2026/2027"
      && event?.academic?.semester === "autumn"),
    eventGroup: events.every((event) => event?.audience?.group === group && String(event?.audience?.stream) === stream),
    eventSource: events.every((event) => event?.source?.file_hash === `sha256:${expected.sourceSha256}`),
    eventVersion: events.every((event) => event?.system?.schedule_version_id === item?.scheduleVersionId),
    revision: events.every((event) => event?.system?.revision === 1),
    uniqueEventIds: new Set(eventIds).size === events.length,
  };
  return { stream, checks, passed: Object.values(checks).every(Boolean) };
}

async function jsonResponse(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

async function checkPublicBoundary(baseUrl, fetchImpl = fetch) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (!/^https:\/\//u.test(base)) throw new Error("Production base URL must be HTTPS");
  const representatives = [
    { stream: "1", group: "ОЛД 201" },
    { stream: "2", group: "ОЛД 213" },
    { stream: "3", group: "ОЛД 225" },
    { stream: "4", group: "ОЛД 237" },
  ];
  const health = await jsonResponse(fetchImpl, `${base}/health`);
  const meta = await jsonResponse(fetchImpl, `${base}/api/v2/meta`);
  const catalog = await jsonResponse(fetchImpl, `${base}/api/v2/catalog/ugmu/programs`);
  const schedules = [];
  for (const rep of representatives) {
    const groupId = encodeURIComponent(`ugmu:medicine:2:stream-${rep.stream}:${rep.group}`);
    schedules.push(await jsonResponse(fetchImpl, `${base}/api/v2/schedules/ugmu/medicine/2/${groupId}/schedule?groupCode=${encodeURIComponent(rep.group)}&stream=${rep.stream}`));
  }
  const runtimeState = {
    sales: meta?.body?.sales ?? null,
    trials: meta?.body?.trials ?? null,
    ugmuTrials: meta?.body?.universityTrials?.ugmu ?? null,
    paymentMode: meta?.body?.paymentMode ?? null,
  };
  const checks = {
    health: health.status === 200 && health.body?.status === "ok" && health.body?.service === "medical-calendar-api",
    metaReadable: meta.status === 200,
    catalogClosed: catalog.status === 404 && ["catalog_not_available", "not_found"].includes(catalog.body?.error),
    course2SchedulesClosed: schedules.every((response) => response.status === 404 && ["schedule_not_published", "not_found"].includes(response.body?.error)),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    runtimeState,
    observed: {
      catalog: { status: catalog.status, error: catalog.body?.error || null },
      schedules: schedules.map((response, index) => ({ ...representatives[index], status: response.status, error: response.body?.error || null })),
    },
  };
}

async function rollbackTouched({ s3, bucket, touched }) {
  const results = [];
  for (const item of [...touched].reverse()) {
    const current = await getObject(s3, bucket, item.storageKey);
    if (!current.exists) {
      results.push({ group: item.group, storageKey: item.storageKey, restored: true, mode: "already-absent" });
      continue;
    }
    const currentSha256 = sha256(current.body);
    if (currentSha256 !== item.writtenSha256) {
      results.push({ group: item.group, storageKey: item.storageKey, restored: false, mode: "sha-changed-manual-review", currentSha256, expectedWrittenSha256: item.writtenSha256 });
      continue;
    }
    await deleteObject(s3, bucket, item.storageKey);
    const after = await headObject(s3, bucket, item.storageKey);
    results.push({ group: item.group, storageKey: item.storageKey, restored: !after.exists, mode: "delete-staged-object" });
  }
  return results;
}

export async function stageCourse2ProductionStorage({
  s3,
  bucket,
  authority,
  authorityText,
  confirmation,
  preactivationReport,
  batchesDir,
  productionBaseUrl,
  boundaryChecker = checkPublicBoundary,
}) {
  if (!s3 || !bucket) throw new Error("Production S3 client/bucket is required");
  const authorityResult = requireAuthority(authority, authorityText);
  const confirmationChecks = requireConfirmation(confirmation, authorityResult.digest);
  const preactivationChecks = requirePreactivationReport(preactivationReport);

  const preBoundary = await boundaryChecker(productionBaseUrl);
  if (!preBoundary?.passed) {
    const error = new Error("UGMU course-2 public boundary is unsafe before storage stage");
    error.boundary = preBoundary;
    throw error;
  }

  const planned = [];
  const globalEventIds = new Set();
  let eventTotal = 0;
  for (const group of EXPECTED_GROUPS) {
    const item = preactivationReport.groups[group];
    if (!item) throw new Error(`Missing preactivation group record: ${group}`);
    const file = path.resolve(batchesDir, `${group.replaceAll(" ", "-")}.json`);
    const body = await fs.readFile(file);
    let batch;
    try { batch = JSON.parse(body.toString("utf8")); } catch { throw new Error(`${group}: invalid batch JSON`); }
    const identity = validateBatch(batch, group, item);
    if (!identity.passed) {
      const error = new Error(`${group}: prepared batch identity failed`);
      error.checks = identity.checks;
      throw error;
    }
    for (const event of batch.events) {
      if (globalEventIds.has(event.system.event_id)) throw new Error(`Global duplicate event_id: ${event.system.event_id}`);
      globalEventIds.add(event.system.event_id);
    }
    const target = await headObject(s3, bucket, item.storageKey);
    if (target.exists) {
      const error = new Error(`${group}: production target is no longer free`);
      error.code = "TARGET_OCCUPIED";
      error.storageKey = item.storageKey;
      throw error;
    }
    const bodySha256 = sha256(body);
    planned.push({ group, stream: identity.stream, storageKey: item.storageKey, eventCount: batch.events.length, body, bodySha256 });
    eventTotal += batch.events.length;
  }
  if (planned.length !== 48 || eventTotal !== EXPECTED_EVENTS || globalEventIds.size !== EXPECTED_EVENTS) {
    throw new Error("Prepared course-2 production scope totals changed");
  }

  const touched = [];
  const records = [];
  let rollback = [];
  try {
    for (const item of planned) {
      await createObjectOnly(s3, bucket, item.storageKey, item.body);
      touched.push({ group: item.group, storageKey: item.storageKey, writtenSha256: item.bodySha256 });
      const readback = await getObject(s3, bucket, item.storageKey);
      const actualSha256 = readback.exists ? sha256(readback.body) : null;
      if (!readback.exists || actualSha256 !== item.bodySha256) {
        throw new Error(`${item.group}: immediate production read-back mismatch`);
      }
      records.push({
        group: item.group,
        stream: item.stream,
        storageKey: item.storageKey,
        eventCount: item.eventCount,
        expectedSha256: item.bodySha256,
        actualSha256,
        verified: true,
      });
    }

    const postBoundary = await boundaryChecker(productionBaseUrl);
    const runtimeUnchanged = JSON.stringify(postBoundary?.runtimeState) === JSON.stringify(preBoundary?.runtimeState);
    if (!postBoundary?.passed || !runtimeUnchanged) {
      const error = new Error("UGMU public/runtime boundary changed after course-2 storage stage");
      error.preBoundary = preBoundary;
      error.postBoundary = postBoundary;
      error.runtimeUnchanged = runtimeUnchanged;
      throw error;
    }

    return {
      version: 1,
      kind: "ugmu-course2-production-storage-stage-report",
      status: "PASS",
      passed: true,
      authoritySha256: authorityResult.digest,
      authorityChecks: authorityResult.checks,
      confirmationChecks,
      preactivationChecks,
      totals: {
        groups: planned.length,
        events: eventTotal,
        staged: records.length,
        verified: records.filter((item) => item.verified).length,
        uniqueEventIds: globalEventIds.size,
      },
      groups: records,
      boundary: {
        pre: preBoundary,
        post: postBoundary,
        runtimeStateUnchanged: true,
      },
      rollbackPerformed: false,
      rollback,
      mutation: {
        productionStorageWrite: true,
        objectCreates: records.length,
        objectUpdates: 0,
        objectDeletes: 0,
        catalogMutation: false,
        accessPolicyMutation: false,
        salesMutation: false,
        trialsMutation: false,
        publicIcsMutation: false,
        otherUniversitiesTouched: false,
      },
      nextRequiredBoundary: "production-readback-then-separate-catalog-access-decision",
    };
  } catch (error) {
    rollback = await rollbackTouched({ s3, bucket, touched });
    const rollbackPassed = rollback.every((item) => item.restored);
    error.rollback = rollback;
    error.rollbackPassed = rollbackPassed;
    throw error;
  }
}

async function main() {
  const authorityPath = path.resolve(arg("authority"));
  const confirmationPath = path.resolve(arg("confirmation"));
  const preactivationReportPath = path.resolve(arg("preactivation-report"));
  const batchesDir = path.resolve(arg("batches-dir"));
  const reportPath = path.resolve(arg("report", "data/imports/ugmu-course2/production-storage-stage/report.json"));
  const productionBaseUrl = arg("production-base-url", "https://kgmu-calendar-api.containerapps.ru");
  if (!authorityPath || !confirmationPath || !preactivationReportPath || !batchesDir) {
    throw new Error("--authority, --confirmation, --preactivation-report and --batches-dir are required");
  }

  const [authorityText, confirmationText, preactivationText] = await Promise.all([
    fs.readFile(authorityPath, "utf8"),
    fs.readFile(confirmationPath, "utf8"),
    fs.readFile(preactivationReportPath, "utf8"),
  ]);
  const authority = JSON.parse(authorityText);
  const confirmation = JSON.parse(confirmationText);
  const preactivationReport = JSON.parse(preactivationText);

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

  try {
    const report = await stageCourse2ProductionStorage({
      s3,
      bucket,
      authority,
      authorityText,
      confirmation,
      preactivationReport,
      batchesDir,
      productionBaseUrl,
    });
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, stableJson(report), "utf8");
    console.log(JSON.stringify(report.totals));
  } catch (error) {
    const failure = {
      version: 1,
      kind: "ugmu-course2-production-storage-stage-report",
      status: "FAIL",
      passed: false,
      error: error?.message || String(error),
      code: error?.code || null,
      rollbackPerformed: Array.isArray(error?.rollback) && error.rollback.length > 0,
      rollbackPassed: error?.rollbackPassed ?? null,
      rollback: error?.rollback || [],
    };
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, stableJson(failure), "utf8");
    throw error;
  }
}

if (process.argv[1]) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

export { AUTHORITY_SHA256, CONFIRM_PHRASE, EXPECTED_EVENTS, EXPECTED_GROUPS, validateBatch };
