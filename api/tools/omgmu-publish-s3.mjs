import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function validScheduleKey(value) {
  return typeof value === "string" && value.startsWith("schedules/omgmu/") && !value.includes("..");
}

if (process.argv.includes("--confirm")) {
  const error = new Error(
    "Direct ОмГМУ S3 publication is retired. Publish only a reviewed canonical schedule-batch through publishScheduleBatch()/YearAwareStore/current.json.",
  );
  error.code = "OMG_LEGACY_DIRECT_PUBLICATION_RETIRED";
  throw error;
}

const packageDir = path.resolve(arg("package", "data/publication/omgmu"));
const manifestPath = path.join(packageDir, "publication-manifest.json");
const expectedPublishable = Number(arg("expected-publishable", "43"));
const expectedBlocked = Number(arg("expected-blocked", "0"));
const reportPath = path.resolve(arg("report", path.join(packageDir, "legacy-s3-plan-report.json")));

const bucket = process.env.S3_BUCKET || "kgmu-calendar-data-gmarkov634";
const endpoint = process.env.S3_ENDPOINT || "https://s3.cloud.ru";

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
  objects.push({ ...item, sha256, eventCount: schedule.events.length });
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
  version: 2,
  university: "omgmu",
  mode: "legacy-debug-plan-only",
  generatedAt: new Date().toISOString(),
  bucket,
  endpoint,
  expectedPublishable,
  expectedBlocked,
  directPublicationEnabled: false,
  canonicalPublicationRequired: true,
  canonicalEntrypoint: "publishScheduleBatch",
  plannedLegacyObjects: objects.map(({ group, key, sha256, eventCount }) => ({ group, key, sha256, eventCount })),
  blockedLegacyObjects: blocked,
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Legacy debug plan only: ${objects.length} schedule object(s), ${blocked.length} blocked object(s).`);
console.log("No S3 write/delete operation is available. Canonical publication must use publishScheduleBatch()/YearAwareStore/current.json.");
console.log(`Report: ${reportPath}`);
