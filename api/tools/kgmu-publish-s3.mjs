import fs from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildKgmuS3WriteSet } from "../src/adapters/kgmu/s3-publication.mjs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function isNotFound(error) {
  return error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
}

const apply = process.argv.includes("--apply");
const planPath = path.resolve(arg("plan", "data/imports/kgmu-2026-27-publication-plan.json"));
const reportPath = path.resolve(arg("report", "data/imports/kgmu-s3-publication-report.json"));
const academicYearArg = arg("academic-year");
const semesterArg = arg("semester");

if (!academicYearArg || !semesterArg) {
  throw new Error("--academic-year and --semester are required for KGMU S3 validation");
}

const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
const writeSet = buildKgmuS3WriteSet(plan, {
  academicYear: academicYearArg,
  semester: Number(semesterArg),
});

const bucket = process.env.S3_BUCKET || "kgmu-calendar-data-gmarkov634";
const endpoint = process.env.S3_ENDPOINT || "https://s3.cloud.ru";
const region = process.env.S3_REGION || "ru-central-1";

const report = {
  version: 1,
  university: "kgmu",
  mode: apply ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  academicYear: writeSet.expectedAcademicYear,
  semester: writeSet.expectedSemester,
  bucket,
  endpoint,
  blockedInPlan: writeSet.blockedCount,
  planned: writeSet.objects.map(({ group, key, bodySha256, sourceSha256, eventCount }) => ({
    group,
    key,
    bodySha256,
    sourceSha256,
    eventCount,
  })),
  uploaded: [],
  unchanged: [],
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });

if (!apply) {
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("KGMU S3 publication: DRY RUN ONLY");
  console.log(`Validated objects: ${writeSet.objects.length}`);
  console.log(`Blocked groups in source plan: ${writeSet.blockedCount}`);
  console.log(`No S3 client was created and no network write was attempted.`);
  console.log(`Report: ${reportPath}`);
  process.exit(0);
}

const accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";
if (!accessKeyId || !secretAccessKey) {
  throw new Error("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required with --apply");
}

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

for (const object of writeSet.objects) {
  let unchanged = false;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
    unchanged = head.Metadata?.sha256 === object.bodySha256 &&
      head.Metadata?.sourcesha256 === object.sourceSha256;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const summary = {
    group: object.group,
    key: object.key,
    bodySha256: object.bodySha256,
    sourceSha256: object.sourceSha256,
    eventCount: object.eventCount,
  };

  if (unchanged) {
    report.unchanged.push(summary);
    continue;
  }

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: object.key,
    Body: object.bodyText,
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-cache",
    Metadata: {
      sha256: object.bodySha256,
      sourcesha256: object.sourceSha256,
      university: "kgmu",
      group: object.group,
      academicyear: writeSet.expectedAcademicYear.replace("/", "-"),
      semester: String(writeSet.expectedSemester),
    },
  }));
  report.uploaded.push(summary);
}

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`KGMU S3 publication applied: uploaded ${report.uploaded.length}, unchanged ${report.unchanged.length}`);
console.log(`No blocked objects were deleted.`);
console.log(`Report: ${reportPath}`);
