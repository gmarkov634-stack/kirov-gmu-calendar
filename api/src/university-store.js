import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ScheduleStore } from "./store.js";
import {
  academicYearStorageSegment,
  normalizeAcademicYear,
  scheduleContext,
  scheduleFlatStorageKey,
  scheduleStorageKey,
} from "./order-context.js";

const TEST_FIXTURE_URL = new URL("../fixtures/kgmu-pediatrics-1-132-autumn-2026.json", import.meta.url);

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

function scheduleGroupFromFilename(filename) {
  if (typeof filename !== "string" || !filename.endsWith(".json")) return null;
  let groupId;
  try {
    groupId = decodeURIComponent(filename.slice(0, -5));
  } catch {
    return null;
  }
  if (!groupId) return null;
  const groupCode = groupId.split(":").at(-1)?.trim();
  if (!groupCode) return null;
  return {
    groupId,
    groupCode,
    displayName: `Группа ${groupCode}`,
  };
}

function legacyKgmuScheduleKey(context) {
  if (
    context.university !== "kgmu" ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(context.program || "") ||
    !Number.isInteger(context.course) ||
    context.course < 1 ||
    !/^\d{3}$/.test(context.groupCode || "")
  ) return null;
  return `schedules/${context.program}/${context.course}/${context.groupCode}.json`;
}

function legacyKgmuGroup(program, course, filename) {
  const match = String(filename || "").match(/^(\d{3})\.json$/);
  if (!match) return null;
  const groupCode = match[1];
  return {
    groupId: `kgmu:${program}:${course}:${groupCode}`,
    groupCode,
    displayName: `Группа ${groupCode}`,
  };
}

function isTestFixtureContext(context) {
  return context.university === "kgmu" &&
    context.program === "pediatrics" &&
    context.course === 1 &&
    context.groupCode === "132";
}

async function readTestFixture() {
  return JSON.parse(await fs.readFile(TEST_FIXTURE_URL, "utf8"));
}

function sortGroups(groups) {
  return groups.sort((a, b) =>
    a.groupCode.localeCompare(b.groupCode, "ru", { numeric: true, sensitivity: "base" }),
  );
}

function validSemester(value) {
  const semester = Number(value);
  return [1, 2].includes(semester) ? semester : null;
}

function requestedPeriods(input, config) {
  const academicYear = normalizeAcademicYear(input?.academicYear || config.offerAcademicYear);
  const semester = validSemester(input?.semester) || validSemester(config.offerSemester);
  if (!academicYear) return [];
  if (input?.plan === "year") {
    return [
      { academicYear, semester: 2 },
      { academicYear, semester: 1 },
    ];
  }
  return semester ? [{ academicYear, semester }] : [];
}

function samePeriod(schedule, period) {
  const actual = scheduleContext(schedule);
  return normalizeAcademicYear(actual.academicYear) === period.academicYear && actual.semester === period.semester;
}

function matchesAnyPeriod(schedule, periods) {
  return periods.length === 0 || periods.some((period) => samePeriod(schedule, period));
}

function versionedKeyInfo(basePrefix, key) {
  if (typeof key !== "string" || !key.startsWith(basePrefix)) return null;
  const relative = key.slice(basePrefix.length);
  const match = relative.match(/^(\d{4}-\d{4})\/semester-([12])\/([^/]+\.json)$/);
  if (!match) return null;
  return {
    academicYear: normalizeAcademicYear(match[1]),
    semester: Number(match[2]),
    filename: match[3],
  };
}

export class MultiUniversityStore extends ScheduleStore {
  async getSchedule(input) {
    const context = scheduleContext(input);
    const flatKey = scheduleFlatStorageKey(context);
    const periods = requestedPeriods(input, this.config);
    const cachePeriod = periods.map((period) => `${period.academicYear}:${period.semester}`).join(",") || "any";
    const cacheKey = `schedule:${flatKey}:${input?.plan || "semester"}:${cachePeriod}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    if (this.config.testScheduleFixtureEnabled && isTestFixtureContext(context)) {
      const value = await readTestFixture();
      if (matchesAnyPeriod(value, periods)) {
        this.cache.set(cacheKey, {
          value,
          expiresAt: Date.now() + this.config.cacheTtlMs,
        });
        return value;
      }
    }

    const candidates = [];
    for (const period of periods) {
      candidates.push({
        key: scheduleStorageKey({
          ...context,
          academicYear: period.academicYear,
          semester: period.semester,
        }),
        period,
        strictPeriod: true,
      });
    }
    candidates.push({ key: flatKey, strictPeriod: false });
    const legacyKey = legacyKgmuScheduleKey(context);
    if (legacyKey && legacyKey !== flatKey) candidates.push({ key: legacyKey, strictPeriod: false });

    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.key)) continue;
      seen.add(candidate.key);

      let value = null;
      if (this.s3) {
        try {
          const response = await this.s3.send(new GetObjectCommand({
            Bucket: this.config.bucket,
            Key: candidate.key,
          }));
          value = JSON.parse(await response.Body.transformToString("utf8"));
        } catch (error) {
          if (isMissingObject(error)) continue;
          throw error;
        }
      } else {
        try {
          value = JSON.parse(await fs.readFile(path.join(this.config.dataDir, candidate.key), "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
      }

      if (candidate.strictPeriod && !samePeriod(value, candidate.period)) {
        throw new Error(`Schedule period does not match storage key: ${candidate.key}`);
      }
      if (!matchesAnyPeriod(value, periods)) continue;

      this.cache.set(cacheKey, {
        value,
        expiresAt: Date.now() + this.config.cacheTtlMs,
      });
      return value;
    }

    return null;
  }

  async listScheduleGroups(input) {
    const context = scheduleContext(input);
    if (!context.university || !context.program || !Number.isInteger(context.course) || context.course < 1) {
      throw new Error("Incomplete schedule context");
    }

    const expectedAcademicYear = input?.academicYear == null
      ? null
      : normalizeAcademicYear(input.academicYear);
    if (input?.academicYear != null && !expectedAcademicYear) {
      throw new Error("Invalid academic year");
    }

    const expectedSemester = input?.semester == null ? null : validSemester(input.semester);
    if (input?.semester != null && !expectedSemester) {
      throw new Error("Invalid semester");
    }

    const basePrefix = `schedules/${context.university}/${context.program}/${context.course}/`;
    const legacyPrefix = context.university === "kgmu"
      ? `schedules/${context.program}/${context.course}/`
      : null;
    const groups = new Map();

    const addKey = (key) => {
      if (typeof key !== "string" || !key.startsWith(basePrefix)) return;
      const relative = key.slice(basePrefix.length);
      if (!relative) return;

      if (!relative.includes("/")) {
        const group = scheduleGroupFromFilename(relative);
        if (group) groups.set(group.groupId, group);
        return;
      }

      const versioned = versionedKeyInfo(basePrefix, key);
      if (!versioned) return;
      if (expectedAcademicYear && versioned.academicYear !== expectedAcademicYear) return;
      if (expectedSemester && versioned.semester !== expectedSemester) return;
      const group = scheduleGroupFromFilename(versioned.filename);
      if (group) groups.set(group.groupId, group);
    };

    const addLegacyKey = (key) => {
      if (!legacyPrefix || typeof key !== "string" || !key.startsWith(legacyPrefix)) return;
      const filename = key.slice(legacyPrefix.length);
      if (!filename || filename.includes("/")) return;
      const group = legacyKgmuGroup(context.program, context.course, filename);
      if (group && !groups.has(group.groupId)) groups.set(group.groupId, group);
    };

    if (this.config.testScheduleFixtureEnabled && context.university === "kgmu" && context.program === "pediatrics" && context.course === 1) {
      const fixture = await readTestFixture();
      const fixtureContext = scheduleContext(fixture);
      const yearMatches = !expectedAcademicYear || normalizeAcademicYear(fixtureContext.academicYear) === expectedAcademicYear;
      const semesterMatches = !expectedSemester || fixtureContext.semester === expectedSemester;
      if (yearMatches && semesterMatches) {
        groups.set("kgmu:pediatrics:1:132", {
          groupId: "kgmu:pediatrics:1:132",
          groupCode: "132",
          displayName: "Группа 132",
        });
      }
    }

    if (this.s3) {
      const listPrefix = async (targetPrefix, add) => {
        let continuationToken;
        do {
          const response = await this.s3.send(new ListObjectsV2Command({
            Bucket: this.config.bucket,
            Prefix: targetPrefix,
            ContinuationToken: continuationToken,
          }));
          for (const object of response.Contents || []) add(object.Key || "");
          continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        } while (continuationToken);
      };
      await listPrefix(basePrefix, addKey);
      if (legacyPrefix) await listPrefix(legacyPrefix, addLegacyKey);
    } else {
      const walkDirectory = async (directory, relativePrefix = "") => {
        let entries = [];
        try {
          entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        for (const entry of entries) {
          const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walkDirectory(path.join(directory, entry.name), relative);
          } else {
            addKey(`${basePrefix}${relative}`);
          }
        }
      };
      await walkDirectory(path.join(this.config.dataDir, basePrefix));

      if (legacyPrefix) {
        const directory = path.join(this.config.dataDir, legacyPrefix);
        let names = [];
        try {
          names = await fs.readdir(directory);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        for (const name of names) addLegacyKey(`${legacyPrefix}${name}`);
      }
    }

    const candidates = sortGroups([...groups.values()]);
    if (!expectedAcademicYear && expectedSemester == null) return candidates;

    const filtered = await Promise.all(candidates.map(async (group) => {
      const schedule = await this.getSchedule({
        university: context.university,
        program: context.program,
        course: context.course,
        groupId: group.groupId,
        groupCode: group.groupCode,
        academicYear: expectedAcademicYear || undefined,
        semester: expectedSemester || undefined,
      });
      if (!schedule) return null;
      const actual = scheduleContext(schedule);
      if (expectedAcademicYear && normalizeAcademicYear(actual.academicYear) !== expectedAcademicYear) return null;
      if (expectedSemester != null && actual.semester !== expectedSemester) return null;
      return {
        ...group,
        displayName: actual.groupDisplayName || group.displayName,
      };
    }));

    return sortGroups(filtered.filter(Boolean));
  }
}
