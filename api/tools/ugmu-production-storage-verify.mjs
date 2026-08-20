import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { checkUgmuPublicBoundary } from "./ugmu-production-storage-stage.mjs";

const EXPECTED_MANIFEST_SHA256 = "2d8103b1c0a873c8cd52cc569426338342f2671ce0d740db6f3f0482590262e5";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

async function bodyBuffer(response) {
  if (typeof response?.Body?.transformToByteArray === "function") return Buffer.from(await response.Body.transformToByteArray());
  if (typeof response?.Body?.transformToString === "function") return Buffer.from(await response.Body.transformToString("utf8"));
  const chunks = [];
  for await (const chunk of response?.Body || []) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
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

export async function verifyUgmuProductionStorage({ s3, bucket, manifest, manifestText, productionBaseUrl }) {
  const manifestSha256 = sha256(manifestText);
  if (manifestSha256 !== EXPECTED_MANIFEST_SHA256 || manifest?.passed !== true || manifest?.groups?.length !== 12) {
    throw new Error("UGMU verification manifest is not the approved step-22 manifest");
  }

  const groups = [];
  for (const item of manifest.groups) {
    const target = await getObject(s3, bucket, item.storageKey);
    const snapshot = await getObject(s3, bucket, item.rollback.snapshotKey);
    const actualSha256 = target.exists ? sha256(target.body) : null;
    groups.push({
      group: item.group,
      storageKey: item.storageKey,
      expectedSha256: item.hashes.scheduleSha256,
      actualSha256,
      scheduleExists: target.exists,
      scheduleHashMatches: actualSha256 === item.hashes.scheduleSha256,
      rollbackSnapshotKey: item.rollback.snapshotKey,
      rollbackSnapshotExists: snapshot.exists,
      eventCount: item.eventCount,
    });
  }

  const boundary = await checkUgmuPublicBoundary(productionBaseUrl);
  const checks = {
    allSchedulesPresent: groups.every((item) => item.scheduleExists),
    allScheduleHashesMatch: groups.every((item) => item.scheduleHashMatches),
    allRollbackSnapshotsPresent: groups.every((item) => item.rollbackSnapshotExists),
    exactGroups: groups.length === 12,
    exactEvents: groups.reduce((sum, item) => sum + item.eventCount, 0) === 4286,
    publicBoundaryClosed: boundary.passed === true,
  };

  return {
    version: 1,
    kind: "ugmu-production-storage-readback-report",
    status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    verifiedAt: new Date().toISOString(),
    manifestId: manifest.manifestId,
    manifestSha256,
    bucket,
    totals: {
      groups: groups.length,
      events: groups.reduce((sum, item) => sum + item.eventCount, 0),
      schedulesPresent: groups.filter((item) => item.scheduleExists).length,
      hashesMatched: groups.filter((item) => item.scheduleHashMatches).length,
      rollbackSnapshotsPresent: groups.filter((item) => item.rollbackSnapshotExists).length,
    },
    groups,
    boundary,
    checks,
    mutationPerformed: false,
    nextRequiredBoundary: Object.values(checks).every(Boolean) ? "deploy-isolation-guards" : "production-storage-staging-recovery",
    passed: Object.values(checks).every(Boolean),
  };
}

async function main() {
  const manifestPath = path.resolve(arg("manifest", "data/imports/ugmu-preactivation-dry-run/manifest.json"));
  const reportPath = path.resolve(arg("report", "data/imports/ugmu-production-storage-verify/report.json"));
  const productionBaseUrl = arg("production-base-url", "https://kgmu-calendar-api.containerapps.ru");
  const manifestText = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);

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

  const report = await verifyUgmuProductionStorage({ s3, bucket, manifest, manifestText, productionBaseUrl });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`UGMU production storage read-back: ${report.status}`);
  console.log(`Schedules: ${report.totals.schedulesPresent}/12; hashes: ${report.totals.hashesMatched}/12; rollback snapshots: ${report.totals.rollbackSnapshotsPresent}/12`);
  if (!report.passed) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
