import fs from "node:fs/promises";
import path from "node:path";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { academicYearStorageSegment } from "./order-context.js";

const PROGRAM_ID = /^[a-z][a-z0-9-]{1,31}$/;

async function listKeys(store, prefix) {
  const keys = [];
  if (store.s3) {
    let continuationToken;
    do {
      const response = await store.s3.send(new ListObjectsV2Command({
        Bucket: store.config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const object of response.Contents || []) {
        if (typeof object.Key === "string") keys.push(object.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  const root = path.join(store.config.dataDir, prefix);
  const walk = async (directory, relativePrefix = "") => {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else keys.push(`${prefix}${relative}`);
    }
  };
  await walk(root);
  return keys;
}

function addPublishedContext(result, relative, expectedYear, expectedSemester, expectedFilename) {
  const parts = relative.split("/");
  if (parts.length !== 5) return;
  const [program, courseText, academicYear, semesterText, filename] = parts;
  const course = Number(courseText);
  if (
    !PROGRAM_ID.test(program) ||
    !Number.isInteger(course) ||
    course < 1 ||
    course > 9 ||
    academicYear !== expectedYear ||
    semesterText !== `semester-${expectedSemester}` ||
    !expectedFilename(filename)
  ) return;
  if (!result.has(program)) result.set(program, new Set());
  result.get(program).add(course);
}

export async function listOfferProgramAvailability({ store, university, academicYear, semester }) {
  const year = academicYearStorageSegment(academicYear);
  const semesterNumber = Number(semester);
  if (!year || ![1, 2].includes(semesterNumber)) throw new Error("Invalid offer period");

  const cacheKey = `offer-program-availability:${university}:${year}:${semesterNumber}`;
  const cached = store.cache?.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const result = new Map();
  const schedulePrefix = `schedules/${university}/`;
  const scheduleKeys = await listKeys(store, schedulePrefix);
  for (const key of scheduleKeys) {
    if (!key.startsWith(schedulePrefix)) continue;
    addPublishedContext(
      result,
      key.slice(schedulePrefix.length),
      year,
      semesterNumber,
      (filename) => filename.endsWith(".json"),
    );
  }

  if (university === "kgmu") {
    const bundlePrefix = "schedule-bundles/kgmu/";
    const bundleKeys = await listKeys(store, bundlePrefix);
    for (const key of bundleKeys) {
      if (!key.startsWith(bundlePrefix)) continue;
      addPublishedContext(
        result,
        key.slice(bundlePrefix.length),
        year,
        semesterNumber,
        (filename) => filename === "current.json",
      );
    }
  }

  const value = [...result.entries()]
    .map(([program, courses]) => ({ program, courses: [...courses].sort((a, b) => a - b) }))
    .sort((a, b) => a.program.localeCompare(b.program));
  if (store.cache) {
    store.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + Math.max(1_000, Number(store.config.cacheTtlMs) || 60_000),
    });
  }
  return value;
}
