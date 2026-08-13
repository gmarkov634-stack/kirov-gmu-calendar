import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
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

function isCanonicalSchedule(schedule) {
  return schedule?.schema_version === "1.0" && Boolean(schedule?.schedule) && Array.isArray(schedule?.events);
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

function canonicalPublicationBase(context) {
  const year = academicYearStorageSegment(context.academicYear);
  if (
    !context.university ||
    !context.program ||
    !Number.isInteger(context.course) ||
    context.course < 1 ||
    !context.groupId ||
    !year ||
    ![1, 2].includes(Number(context.semester))
  ) return null;
  return `schedule-publications/${context.university}/${context.program}/${context.course}/${year}/semester-${context.semester}/${encodeURIComponent(context.groupId)}`;
}

function sameBundleContext(schedule, expected) {
  const actual = scheduleContext(schedule);
  return actual.university === expected.university &&
    actual.program === expected.program &&
    actual.course === expected.course &&
    normalizeAcademicYear(actual.academicYear) === normalizeAcademicYear(expected.academicYear) &&
    actual.semester === expected.semester;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function mergeCanonicalYearSchedules(schedules) {
  const [base] = schedules;
  const events = uniqueBy(
    schedules.flatMap((schedule) => schedule.events || []),
    (event) => event?.system?.event_id || [
      event?.timing?.date,
      event?.timing?.start_time,
      event?.lesson?.discipline?.normalized,
      event?.lesson?.type?.code,
    ].join("|"),
  ).sort((a, b) => {
    const left = `${a?.timing?.date || ""}T${a?.timing?.start_time || ""}|${a?.system?.event_id || ""}`;
    const right = `${b?.timing?.date || ""}T${b?.timing?.start_time || ""}|${b?.system?.event_id || ""}`;
    return left.localeCompare(right);
  });
  const periods = schedules.map((schedule) => schedule.schedule?.period).filter(Boolean);
  const versionParts = schedules.map((schedule) => schedule.schedule?.schedule_version_id || "").sort();
  const fingerprintParts = schedules.map((schedule) => schedule.schedule?.content_fingerprint || "").sort();
  const versionCreatedAt = schedules.map((schedule) => schedule.schedule?.version_created_at).filter(Boolean).sort().at(-1) || new Date(0).toISOString();
  return {
    schema_version: "1.0",
    schedule: {
      ...base.schedule,
      semester: "other",
      period: {
        start_date: periods.map((period) => period.start_date).filter(Boolean).sort()[0] || base.schedule.period?.start_date,
        end_date: periods.map((period) => period.end_date).filter(Boolean).sort().at(-1) || base.schedule.period?.end_date,
        week1_start_date: periods.map((period) => period.week1_start_date).filter(Boolean).sort()[0] || base.schedule.period?.week1_start_date,
      },
      schedule_version_id: `ver_year_${hash(versionParts.join("|")).slice(0, 32)}`,
      previous_schedule_version_id: null,
      content_fingerprint: `sha256:${hash(fingerprintParts.join("|"))}`,
      version_created_at: versionCreatedAt,
      included_semesters: schedules.map((schedule) => schedule.schedule?.semester).filter(Boolean),
    },
    events,
  };
}

export function mergeYearSchedules(first, second) {
  const schedules = [first, second].filter(Boolean);
  if (!schedules.length) return null;
  if (schedules.length === 1) return schedules[0];
  if (schedules.every(isCanonicalSchedule)) return mergeCanonicalYearSchedules(schedules);

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
    if (isCanonicalSchedule(schedule)) return this.putCanonicalSchedule(schedule);

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

  async putCanonicalSchedule(schedule) {
    const context = scheduleContext(schedule);
    const versionId = schedule?.schedule?.schedule_version_id;
    const contentFingerprint = schedule?.schedule?.content_fingerprint;
    const base = canonicalPublicationBase(context);
    if (
      !base ||
      !Array.isArray(schedule?.events) ||
      !/^ver_[A-Za-z0-9_-]+$/.test(String(versionId || "")) ||
      !/^sha256:[0-9a-f]{64}$/.test(String(contentFingerprint || ""))
    ) {
      const error = new Error("Canonical schedule batch is incomplete and cannot be published");
      error.code = "INVALID_CANONICAL_SCHEDULE";
      throw error;
    }

    const versionKey = `${base}/versions/${versionId}.json`;
    const manifestKey = `${base}/current.json`;
    const current = await this.#readJson(manifestKey);
    if (current?.scheduleVersionId === versionId && current?.contentFingerprint === contentFingerprint) {
      return {
        versionKey: current.versionKey,
        manifestKey,
        publishedAt: current.publishedAt,
        scheduleVersionId: versionId,
        unchanged: true,
        compatibilityKeys: current.compatibilityKeys || [],
        compatibilityWarnings: [],
      };
    }

    const existingVersion = await this.#readJson(versionKey);
    if (existingVersion && existingVersion?.schedule?.content_fingerprint !== contentFingerprint) {
      const error = new Error("Existing immutable schedule version has different content");
      error.code = "SCHEDULE_VERSION_IMMUTABILITY_VIOLATION";
      throw error;
    }

    const body = JSON.stringify(schedule);
    if (!existingVersion) await this.#writeRawJson(versionKey, body);

    const publishedAt = new Date().toISOString();
    const compatibilityKeys = [...new Set([scheduleStorageKey(schedule), scheduleFlatStorageKey(schedule)])];
    await this.#writeRawJson(manifestKey, JSON.stringify({
      version: 1,
      format: "schedule-batch/v1",
      versionKey,
      scheduleVersionId: versionId,
      previousScheduleVersionId: schedule.schedule.previous_schedule_version_id ?? null,
      contentFingerprint,
      publishedAt,
      eventCount: schedule.events.length,
      compatibilityKeys,
    }));
    this.cache.clear();

    const compatibilityWarnings = [];
    for (const key of compatibilityKeys) {
      try {
        await this.#writeRawJson(key, body);
      } catch (error) {
        compatibilityWarnings.push({ key, message: String(error?.message || error) });
      }
    }

    return {
      versionKey,
      manifestKey,
      publishedAt,
      scheduleVersionId: versionId,
      compatibilityKeys,
      compatibilityWarnings,
      unchanged: false,
    };
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

    const canonical = await this.#currentCanonical(context);
    if (canonical) return canonical;

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

  async #currentCanonical(context) {
    const base = canonicalPublicationBase(context);
    if (!base) return null;
    const cacheKey = `canonical:${base}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const manifest = await this.#readJson(`${base}/current.json`);
    if (!manifest?.versionKey) return null;
    const schedule = await this.#readJson(manifest.versionKey);
    if (!isCanonicalSchedule(schedule)) return null;
    const actual = scheduleContext(schedule);
    if (
      actual.university !== context.university ||
      actual.program !== context.program ||
      actual.course !== context.course ||
      actual.groupId !== context.groupId ||
      normalizeAcademicYear(actual.academicYear) !== normalizeAcademicYear(context.academicYear) ||
      actual.semester !== context.semester
    ) return null;
    this.cache.set(cacheKey, { value: schedule, expiresAt: Date.now() + this.config.cacheTtlMs });
    return schedule;
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
