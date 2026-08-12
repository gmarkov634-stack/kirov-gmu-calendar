import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { MultiUniversityStore } from "./university-store.js";
import {
  academicYearStorageSegment,
  normalizeAcademicYear,
  scheduleContext,
  scheduleFlatStorageKey,
  scheduleStorageKey,
} from "./order-context.js";

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

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

function bundleBase(context) {
  const year = academicYearStorageSegment(context.academicYear);
  if (
    context.university !== "kgmu" ||
    !context.program ||
    !Number.isInteger(context.course) ||
    context.course < 1 ||
    !year ||
    ![1, 2].includes(Number(context.semester))
  ) return null;
  return `schedule-bundles/kgmu/${context.program}/${context.course}/${year}/semester-${context.semester}`;
}

function sameBundleContext(schedule, expected) {
  const actual = scheduleContext(schedule);
  return actual.university === expected.university &&
    actual.program === expected.program &&
    actual.course === expected.course &&
    normalizeAcademicYear(actual.academicYear) === normalizeAcademicYear(expected.academicYear) &&
    actual.semester === expected.semester;
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
    if (input?.plan === "year") {
      const academicYear = input?.academicYear || this.config.offerAcademicYear;
      const [semester1, semester2] = await Promise.all([
        this.#getPeriodSchedule({ ...input, plan: "semester", academicYear, semester: 1 }),
        this.#getPeriodSchedule({ ...input, plan: "semester", academicYear, semester: 2 }),
      ]);
      return mergeYearSchedules(semester1, semester2);
    }
    return this.#getPeriodSchedule(input);
  }

  async listScheduleGroups(input) {
    const base = await super.listScheduleGroups(input);
    const groups = new Map(base.map((group) => [group.groupId, group]));
    const academicYear = normalizeAcademicYear(input?.academicYear || this.config.offerAcademicYear);
    const semesters = input?.plan === "year"
      ? [1, 2]
      : [Number(input?.semester || this.config.offerSemester)].filter((value) => [1, 2].includes(value));
    if (!academicYear) return base;
    for (const semester of semesters) {
      const context = scheduleContext({ ...input, academicYear, semester });
      const bundle = await this.#currentBundle(context);
      for (const schedule of bundle?.schedules || []) {
        const actual = scheduleContext(schedule);
        if (!actual.groupId || !actual.groupCode) continue;
        groups.set(actual.groupId, {
          groupId: actual.groupId,
          groupCode: actual.groupCode,
          displayName: actual.groupDisplayName || `Группа ${actual.groupCode}`,
        });
      }
    }
    return [...groups.values()].sort((a, b) => a.groupCode.localeCompare(b.groupCode, "ru", { numeric: true, sensitivity: "base" }));
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
    for (const key of [...new Set(keys)]) await this.#writeRawJson(key, body);
    this.cache.clear();
    return { versionedKey: keys[0], flatKey: keys[1] };
  }

  async putScheduleBundle(schedules, { sourceSha256 } = {}) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      const error = new Error("Schedule bundle is empty");
      error.code = "INVALID_SCHEDULE_BUNDLE";
      throw error;
    }
    const context = scheduleContext(schedules[0]);
    const base = bundleBase(context);
    if (!base || schedules.some((schedule) => !sameBundleContext(schedule, context))) {
      const error = new Error("Schedule bundle contains incompatible contexts");
      error.code = "INVALID_SCHEDULE_BUNDLE";
      throw error;
    }
    const groupIds = new Set();
    for (const schedule of schedules) {
      const actual = scheduleContext(schedule);
      if (!actual.groupId || groupIds.has(actual.groupId) || !Array.isArray(schedule.events) || schedule.events.length === 0) {
        const error = new Error("Schedule bundle contains invalid or duplicate group data");
        error.code = "INVALID_SCHEDULE_BUNDLE";
        throw error;
      }
      groupIds.add(actual.groupId);
    }

    const publishedAt = new Date().toISOString();
    const generation = /^[a-f0-9]{64}$/.test(String(sourceSha256 || ""))
      ? String(sourceSha256)
      : publishedAt.replace(/[^0-9]/g, "");
    const bundleKey = `${base}/versions/${generation}.json`;
    const manifestKey = `${base}/current.json`;
    const bundle = {
      version: 1,
      university: context.university,
      program: context.program,
      course: context.course,
      academicYear: context.academicYear,
      semester: context.semester,
      sourceSha256: sourceSha256 || null,
      publishedAt,
      schedules,
    };

    // Atomic publication boundary: the full immutable bundle is written first.
    // Subscribers see it only after the small current.json pointer is replaced.
    await this.#writeRawJson(bundleKey, JSON.stringify(bundle));
    await this.#writeRawJson(manifestKey, JSON.stringify({
      version: 1,
      bundleKey,
      sourceSha256: sourceSha256 || null,
      publishedAt,
      groupCount: schedules.length,
      groupIds: [...groupIds],
    }));
    this.cache.clear();
    return { bundleKey, manifestKey, publishedAt, groupCount: schedules.length };
  }

  async #getPeriodSchedule(input) {
    const academicYear = input?.academicYear || this.config.offerAcademicYear;
    const semester = Number(input?.semester || this.config.offerSemester);
    const resolvedInput = {
      ...input,
      ...(academicYear ? { academicYear } : {}),
      ...([1, 2].includes(semester) ? { semester } : {}),
    };
    const context = scheduleContext(resolvedInput);
    const bundle = await this.#currentBundle(context);
    if (bundle) {
      const requested = scheduleContext(resolvedInput);
      const schedule = (bundle.schedules || []).find((candidate) => {
        const actual = scheduleContext(candidate);
        return (requested.groupId && actual.groupId === requested.groupId) ||
          (requested.groupCode && actual.groupCode === requested.groupCode);
      });
      if (schedule) return schedule;
    }
    return super.getSchedule(resolvedInput);
  }

  async #currentBundle(context) {
    const base = bundleBase(context);
    if (!base) return null;
    const cacheKey = `bundle:${base}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const manifest = await this.#readJson(`${base}/current.json`);
    if (!manifest?.bundleKey) return null;
    const bundle = await this.#readJson(manifest.bundleKey);
    if (!bundle || !Array.isArray(bundle.schedules)) return null;
    this.cache.set(cacheKey, { value: bundle, expiresAt: Date.now() + this.config.cacheTtlMs });
    return bundle;
  }

  async #readJson(key) {
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        return JSON.parse(await response.Body.transformToString("utf8"));
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    }
    try {
      return JSON.parse(await fs.readFile(path.join(this.config.dataDir, key), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async #writeRawJson(key, body) {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
        CacheControl: "no-store",
      }));
      return;
    }
    const filename = path.join(this.config.dataDir, key);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body, { mode: 0o600 });
  }
}
