import fs from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { MultiUniversityStore } from "./university-store.js";
import { scheduleContext, scheduleFlatStorageKey, scheduleStorageKey } from "./order-context.js";

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function mergeYearSchedules(first, second) {
  const schedules = [first, second].filter(Boolean);
  if (!schedules.length) return null;
  if (schedules.length === 1) return schedules[0];
  const [base] = schedules;
  const events = uniqueBy(
    schedules.flatMap((schedule) => Array.isArray(schedule.events) ? schedule.events : []),
    (event) => event?.id || [event?.start, event?.end, event?.title, event?.location].join("|"),
  ).sort((a, b) => String(a?.start || "").localeCompare(String(b?.start || "")));
  const sources = uniqueBy(
    schedules.flatMap((schedule) => Array.isArray(schedule.sources) ? schedule.sources : []),
    (source) => JSON.stringify(source),
  );
  return {
    ...base,
    semester: Number(base.semester) || 1,
    includedSemesters: [...new Set(schedules.map((schedule) => Number(schedule.semester)).filter((value) => [1, 2].includes(value)))].sort(),
    sources,
    events,
  };
}

export class YearAwareStore extends MultiUniversityStore {
  async getSchedule(input) {
    if (input?.plan !== "year") return super.getSchedule(input);
    const academicYear = input?.academicYear || this.config.offerAcademicYear;
    const [semester1, semester2] = await Promise.all([
      super.getSchedule({ ...input, plan: "semester", academicYear, semester: 1 }),
      super.getSchedule({ ...input, plan: "semester", academicYear, semester: 2 }),
    ]);
    return mergeYearSchedules(semester1, semester2);
  }

  async putSchedule(schedule) {
    const context = scheduleContext(schedule);
    if (
      !context.university ||
      !context.program ||
      !Number.isInteger(context.course) ||
      context.course < 1 ||
      !context.groupId ||
      !context.academicYear ||
      ![1, 2].includes(context.semester) ||
      !Array.isArray(schedule?.events) ||
      schedule.events.length === 0
    ) {
      const error = new Error("Schedule is incomplete and cannot be published");
      error.code = "INVALID_PUBLISHED_SCHEDULE";
      throw error;
    }

    const body = JSON.stringify(schedule);
    const keys = [scheduleStorageKey(schedule), scheduleFlatStorageKey(schedule)];
    for (const key of [...new Set(keys)]) {
      if (this.s3) {
        await this.s3.send(new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: "application/json; charset=utf-8",
          CacheControl: "no-store",
        }));
      } else {
        const filename = path.join(this.config.dataDir, key);
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, body, { mode: 0o600 });
      }
    }
    this.cache.clear();
    return { versionedKey: keys[0], flatKey: keys[1] };
  }
}
