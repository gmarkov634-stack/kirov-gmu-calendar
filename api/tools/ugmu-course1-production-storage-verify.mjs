import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import {
  EXPECTED_EVENTS,
  EXPECTED_GROUPS,
  validateApprovedUgmuCourse1ScheduleObject,
} from "./ugmu-course1-production-storage-stage.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function bodyBuffer(response) {
  if (!response?.Body) return Buffer.alloc(0);
  if (typeof response.Body.transformToByteArray === "function") return Buffer.from(await response.Body.transformToByteArray());
  if (typeof response.Body.transformToString === "function") return Buffer.from(await response.Body.transformToString("utf8"), "utf8");
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

async function readObject(s3, bucket, key) {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return { exists: true, body: await bodyBuffer(response) };
  } catch (error) {
    if (isMissingObject(error)) return { exists: false, body: null };
    throw error;
  }
}

function exactManifestScope(manifest) {
  return manifest?.kind === "ugmu-course1-preactivation-schedule-dry-run"
    && manifest?.passed === true
    && manifest?.publicationAllowed === false
    && manifest?.totals?.groups === 50
    && manifest?.totals?.events === EXPECTED_EVENTS
    && JSON.stringify(manifest?.scope?.groups) === JSON.stringify(EXPECTED_GROUPS)
    && Array.isArray(manifest?.groups)
    && manifest.groups.length === 50;
}

export async function verifyUgmuCourse1ProductionStorage({ s3, bucket, manifest }) {
  if (!s3 || !bucket) throw new Error("Production S3 client/bucket is required");
  if (!exactManifestScope(manifest)) throw new Error("UGMU course-1 verification manifest is invalid");

  const groups = [];
  for (const item of manifest.groups) {
    const object = await readObject(s3, bucket, item.storageKey);
    if (!object.exists) {
      groups.push({ group: item.group, storageKey: item.storageKey, exists: false, passed: false, error: "missing" });
      continue;
    }

    const actualSha256 = sha256(object.body);
    let parsed = null;
    let parseError = null;
    try {
      parsed = JSON.parse(object.body.toString("utf8"));
    } catch (error) {
      parseError = error.message;
    }
    const identity = parsed ? validateApprovedUgmuCourse1ScheduleObject(parsed, item) : { passed: false, checks: {} };
    const expectedSha256 = item.hashes?.scheduleSha256 || null;
    const hashMatches = Boolean(expectedSha256) && actualSha256 === expectedSha256;
    groups.push({
      group: item.group,
      stream: item.stream,
      storageKey: item.storageKey,
      exists: true,
      expectedSha256,
      actualSha256,
      hashMatches,
      identityPassed: identity.passed,
      identityChecks: identity.checks,
      parseError,
      passed: hashMatches && identity.passed && !parseError,
    });
  }

  const totals = {
    groups: groups.length,
    events: manifest.groups.reduce((sum, item) => sum + Number(item.eventCount || 0), 0),
    verified: groups.filter((item) => item.passed).length,
    missing: groups.filter((item) => !item.exists).length,
    failed: groups.filter((item) => !item.passed).length,
  };
  const passed = totals.groups === 50 && totals.events === EXPECTED_EVENTS && totals.verified === 50 && totals.failed === 0;
  return {
    version: 1,
    kind: "ugmu-course1-production-storage-readback-report",
    status: passed ? "PASS" : "FAIL",
    readOnly: true,
    totals,
    groups,
    passed,
  };
}

async function main() {
  const manifestPath = path.resolve(arg("manifest", "data/imports/ugmu-course1/preactivation-dry-run/manifest.json"));
  const reportPath = path.resolve(arg("report", "data/imports/ugmu-course1/production-storage-verify/report.json"));
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
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
  const report = await verifyUgmuCourse1ProductionStorage({ s3, bucket, manifest });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`UGMU course-1 production storage readback: ${report.status}`);
  console.log(`Verified: ${report.totals.verified}/50; missing: ${report.totals.missing}; failed: ${report.totals.failed}`);
  if (!report.passed) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
