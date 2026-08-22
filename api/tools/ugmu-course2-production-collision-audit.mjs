#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const EXPECTED_COURSE1_GROUPS = 50;
const EXPECTED_COURSE1_EVENTS = 17301;
const EXPECTED_COURSE2_GROUPS = 48;
const EXPECTED_COURSE2_EVENTS = 11056;
const COURSE1_MANIFEST_ID = "ugmu-course1-2026-autumn-c23093970be0";
const COURSE2_STORAGE_PLAN_SHA256 = "783dba66f9cf48ae47a335c9cb4c9a7a41121d2a7d008b67262b910e8db38c2e";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingObject(error) {
  return error?.name === "NotFound"
    || error?.name === "NoSuchKey"
    || error?.Code === "NoSuchKey"
    || error?.$metadata?.httpStatusCode === 404;
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

function requireCourse1Manifest(manifest) {
  if (
    manifest?.manifestId !== COURSE1_MANIFEST_ID
    || manifest?.passed !== true
    || manifest?.publicationAllowed !== false
    || manifest?.totals?.groups !== EXPECTED_COURSE1_GROUPS
    || manifest?.totals?.events !== EXPECTED_COURSE1_EVENTS
    || !Array.isArray(manifest?.groups)
    || manifest.groups.length !== EXPECTED_COURSE1_GROUPS
  ) {
    throw new Error("Pinned UGMU course-1 manifest is outside the approved production baseline");
  }
}

function requireCourse2Report(report) {
  if (
    report?.stage !== "ics-preactivation-dry-run"
    || report?.university !== "ugmu"
    || report?.program !== "medicine"
    || report?.course !== 2
    || report?.summary?.groupCount !== EXPECTED_COURSE2_GROUPS
    || report?.summary?.eventCount !== EXPECTED_COURSE2_EVENTS
    || report?.summary?.storageTargetCount !== EXPECTED_COURSE2_GROUPS
    || report?.summary?.aggregateStoragePlanSha256 !== COURSE2_STORAGE_PLAN_SHA256
    || report?.summary?.productionStoreCalls !== 0
    || report?.summary?.storageWritesPerformed !== false
    || report?.summary?.publicationAllowed !== false
    || report?.summary?.preactivationReady !== true
    || report?.summary?.reviewRequired !== false
    || Object.keys(report?.groups || {}).length !== EXPECTED_COURSE2_GROUPS
  ) {
    throw new Error("UGMU course-2 preactivation report is outside the reviewed boundary");
  }
}

function requireCatalog(catalog) {
  const medicine = (catalog?.programs || []).find((item) => item?.id === "medicine");
  const courses = (medicine?.courses || []).map((item) => item?.course);
  if (catalog?.university !== "ugmu" || JSON.stringify(courses) !== JSON.stringify([1])) {
    throw new Error("UGMU repository catalog no longer represents the reviewed course-1-only baseline");
  }
  return courses;
}

async function audit({ s3, bucket, course1Manifest, course2Report, catalog }) {
  requireCourse1Manifest(course1Manifest);
  requireCourse2Report(course2Report);
  const catalogCourses = requireCatalog(catalog);

  const course1Keys = new Set();
  const course1 = [];
  for (const item of course1Manifest.groups) {
    const key = String(item.storageKey || "");
    const expectedHash = String(item?.hashes?.scheduleSha256 || "");
    if (!key.startsWith("schedules/ugmu/medicine/1/2026-2027/semester-1/") || !expectedHash) {
      throw new Error(`Course-1 manifest storage target/hash is invalid for ${item.group}`);
    }
    if (course1Keys.has(key)) throw new Error(`Duplicate course-1 storage key: ${key}`);
    course1Keys.add(key);
    const object = await getObject(s3, bucket, key);
    const actualHash = object.exists ? sha256(object.body) : null;
    course1.push({
      group: item.group,
      storageKey: key,
      exists: object.exists,
      expectedSha256: expectedHash,
      actualSha256: actualHash,
      hashMatches: object.exists && actualHash === expectedHash,
    });
  }

  const course2Keys = new Set();
  const course2 = [];
  for (const [group, item] of Object.entries(course2Report.groups)) {
    const key = String(item?.storageKey || "");
    if (!key.startsWith("schedules/ugmu/medicine/2/2026-2027/semester-1/")) {
      throw new Error(`Course-2 storage target escaped its namespace for ${group}`);
    }
    if (course2Keys.has(key)) throw new Error(`Duplicate course-2 storage key: ${key}`);
    course2Keys.add(key);
    const object = await headObject(s3, bucket, key);
    course2.push({
      group,
      stream: item.stream,
      storageKey: key,
      exists: object.exists,
      contentLength: object.contentLength,
      etag: object.etag,
      free: !object.exists,
    });
  }

  const collisionsWithCourse1 = [...course2Keys].filter((key) => course1Keys.has(key));
  const crossUniversityTargets = [...course2Keys].filter((key) => !key.startsWith("schedules/ugmu/"));
  const totals = {
    course1Groups: course1.length,
    course1Present: course1.filter((item) => item.exists).length,
    course1HashesMatched: course1.filter((item) => item.hashMatches).length,
    course2Targets: course2.length,
    course2Free: course2.filter((item) => item.free).length,
    course2Occupied: course2.filter((item) => item.exists).length,
    course1Course2KeyCollisions: collisionsWithCourse1.length,
    crossUniversityTargets: crossUniversityTargets.length,
  };
  const passed = totals.course1Groups === EXPECTED_COURSE1_GROUPS
    && totals.course1Present === EXPECTED_COURSE1_GROUPS
    && totals.course1HashesMatched === EXPECTED_COURSE1_GROUPS
    && totals.course2Targets === EXPECTED_COURSE2_GROUPS
    && totals.course2Free === EXPECTED_COURSE2_GROUPS
    && totals.course2Occupied === 0
    && totals.course1Course2KeyCollisions === 0
    && totals.crossUniversityTargets === 0;

  return {
    version: 1,
    kind: "ugmu-course2-production-collision-readiness-audit",
    mode: "production-read-only",
    status: passed ? "PASS" : "FAIL",
    passed,
    totals,
    catalog: {
      courses: catalogCourses,
      course2Present: catalogCourses.includes(2),
      mutationPerformed: false,
    },
    boundaries: {
      sourceCourse1ManifestId: COURSE1_MANIFEST_ID,
      sourceCourse2StoragePlanSha256: COURSE2_STORAGE_PLAN_SHA256,
      course1Namespace: "schedules/ugmu/medicine/1/2026-2027/semester-1/",
      course2Namespace: "schedules/ugmu/medicine/2/2026-2027/semester-1/",
      productionReadsPerformed: true,
      productionWritesPerformed: false,
      catalogWritesPerformed: false,
      accessPolicyWritesPerformed: false,
      salesChangesPerformed: false,
      publicIcsPublicationPerformed: false,
      otherUniversitiesTouched: false,
    },
    collisionsWithCourse1,
    crossUniversityTargets,
    course1,
    course2,
    readyForControlledStorageStage: passed,
    nextRequiredBoundary: passed ? "explicit-controlled-course2-storage-stage" : "manual-review",
  };
}

async function main() {
  const course1ManifestPath = path.resolve(arg("course1-manifest"));
  const course2ReportPath = path.resolve(arg("course2-report"));
  const catalogPath = path.resolve(arg("catalog", "../universities/ugmu/catalog.json"));
  const reportPath = path.resolve(arg("report", "data/imports/ugmu-course2/production-collision-audit/report.json"));
  if (!course1ManifestPath || !course2ReportPath) throw new Error("--course1-manifest and --course2-report are required");

  const [course1Manifest, course2Report, catalog] = await Promise.all([
    fs.readFile(course1ManifestPath, "utf8").then(JSON.parse),
    fs.readFile(course2ReportPath, "utf8").then(JSON.parse),
    fs.readFile(catalogPath, "utf8").then(JSON.parse),
  ]);

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

  const report = await audit({ s3, bucket, course1Manifest, course2Report, catalog });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.totals));
  if (!report.passed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
