import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function isNotFound(error) {
  return error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
}

function validScheduleKey(value) {
  return typeof value === "string" && value.startsWith("schedules/omgmu/") && !value.includes("..");
}

const confirmed = process.argv.includes("--confirm");
const packageDir = path.resolve(arg("package", "data/publication/omgmu"));
const manifestPath = path.join(packageDir, "publication-manifest.json");
const expectedPublishable = Number(arg("expected-publishable", "39"));
const expectedBlocked = Number(arg("expected-blocked", "4"));
const reportPath = path.resolve(arg("report", path.join(packageDir, "s3-publication-report.json")));

const bucket = process.env.S3_BUCKET || "kgmu-calendar-data-gmarkov634";
const endpoint = process.env.S3_ENDPOINT || "https://s3.cloud.ru";
const region = process.env.S3_REGION || "ru-central-1";
const accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (manifest.university !== "omgmu") throw new Error(`Unexpected university: ${manifest.university}`);
if (manifest.publishableCount !== expectedPublishable) {
  throw new Error(`Expected ${expectedPublishable} publishable schedules, got ${manifest.publishableCount}`);
}
if (manifest.blockedCount !== expectedBlocked) {
  throw new Error(`Expected ${expectedBlocked} blocked schedules, got ${manifest.blockedCount}`);
}
if (!Array.isArray(manifest.objects) || manifest.objects.length !== manifest.publishableCount) {
  throw new Error("Publication manifest object count mismatch");
}
if (!Array.isArray(manifest.blocked) || manifest.blocked.length !== manifest.blockedCount) {
  throw new Error("Publication manifest blocked count mismatch");
}

const seenKeys = new Set();
const objects = [];
for (const item of manifest.objects) {
  if (!item?.key || !item?.file || !item?.group) throw new Error("Invalid publication object entry");
  if (!validScheduleKey(item.key)) throw new Error(`Unsafe publication key: ${item.key}`);
  if (seenKeys.has(item.key)) throw new Error(`Duplicate storage key: ${item.key}`);
  seenKeys.add(item.key);

  const absolute = path.resolve(packageDir, item.file);
  if (!absolute.startsWith(`${packageDir}${path.sep}`)) throw new Error(`Unsafe object path: ${item.file}`);
  const body = await fs.readFile(absolute);
  const schedule = JSON.parse(body.toString("utf8"));
  if (!Array.isArray(schedule.events) || schedule.events.length === 0) {
    throw new Error(`Schedule ${item.group} is empty`);
  }
  const sha256 = createHash("sha256").update(body).digest("hex");
  objects.push({ ...item, absolute, body, sha256, eventCount: schedule.events.length });
}

const blocked = [];
for (const item of manifest.blocked) {
  if (!item?.key || !item?.group || !item?.reason) throw new Error("Invalid blocked publication entry");
  if (!validScheduleKey(item.key)) throw new Error(`Unsafe blocked key: ${item.key}`);
  if (seenKeys.has(item.key)) throw new Error(`Storage key is both publishable and blocked: ${item.key}`);
  seenKeys.add(item.key);
  blocked.push({ group: String(item.group), reason: String(item.reason), key: item.key });
}

const report = {
  version: 1,
  university: "omgmu",
  mode: confirmed ? "publish" : "dry-run",
  generatedAt: new Date().toISOString(),
  bucket,
  endpoint,
  expectedPublishable,
  expectedBlocked,
  uploaded: [],
  unchanged: [],
  deleted: [],
  alreadyAbsent: [],
  planned: [],
  plannedDeletes: [],
};

if (!confirmed) {
  report.planned = objects.map(({ group, key, sha256, eventCount }) => ({ group, key, sha256, eventCount }));
  report.plannedDeletes = blocked.map(({ group, reason, key }) => ({ group, reason, key }));
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Dry-run complete: ${objects.length} objects would be published and ${blocked.length} blocked objects would be removed from s3://${bucket}`);
  console.log(`Report: ${reportPath}`);
  process.exit(0);
}

if (!accessKeyId || !secretAccessKey) {
  throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required with --confirm");
}

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

for (const item of blocked) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key }));
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.key }));
    report.deleted.push(item);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    report.alreadyAbsent.push(item);
  }
}

for (const object of objects) {
  let unchanged = false;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
    unchanged = head.Metadata?.sha256 === object.sha256;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  if (unchanged) {
    report.unchanged.push({ group: object.group, key: object.key, sha256: object.sha256, eventCount: object.eventCount });
    continue;
  }

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: object.key,
    Body: object.body,
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-cache",
    Metadata: {
      sha256: object.sha256,
      university: "omgmu",
      group: String(object.group),
    },
  }));
  report.uploaded.push({ group: object.group, key: object.key, sha256: object.sha256, eventCount: object.eventCount });
}

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Deleted blocked: ${report.deleted.length}; already absent: ${report.alreadyAbsent.length}`);
console.log(`Published: ${report.uploaded.length}; unchanged: ${report.unchanged.length}`);
console.log(`Report: ${reportPath}`);
