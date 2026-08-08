import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const group = readArg("group");
const expiresAt = readArg("expires-at");
const baseUrl = readArg("base-url", "https://kgmu-calendar-api.containerapps.ru").replace(/\/$/, "");
const outputDir = path.resolve(readArg("output", "subscription-output"));
const academicYear = readArg("academic-year", "2025-2026");
const semester = Number(readArg("semester", "2"));
const course = Number(readArg("course", "1"));
const faculty = readArg("faculty", "pediatrics");
const orderId = readArg("order-id", "manual-test");

if (!/^\d{3}$/.test(group || "") || !Number.isFinite(Date.parse(expiresAt || ""))) {
  console.error("Usage: node tools/create-subscription.mjs --group=132 --expires-at=2026-08-31T23:59:59+03:00 [--order-id=test-1]");
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const grant = {
  version: 1,
  status: "active",
  faculty,
  course,
  group,
  academicYear,
  semester,
  expiresAt,
  orderId,
  createdAt: new Date().toISOString(),
};
const url = `${baseUrl}/api/v1/subscriptions/${token}/calendar.ics`;

await fs.mkdir(path.join(outputDir, "subscriptions"), { recursive: true });
await fs.writeFile(path.join(outputDir, "subscriptions", `${hash}.json`), `${JSON.stringify(grant, null, 2)}\n`, { mode: 0o600 });
await fs.writeFile(path.join(outputDir, `subscription-${group}.txt`), `${url}\n`, { mode: 0o600 });

console.log(`Grant: ${path.join(outputDir, "subscriptions", `${hash}.json`)}`);
console.log(`Private URL: ${path.join(outputDir, `subscription-${group}.txt`)}`);
