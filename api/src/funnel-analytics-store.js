import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { academicYearStorageSegment, scheduleContext } from "./order-context.js";
import { postprocessSchedule } from "./schedule/postprocess.js";
import { schedulePersonalizationMatchesSchedule } from "./schedule/personalization-publication.js";
import { projectScheduleForSubscription } from "./subscription-personalization.js";
import { TrialEnabledStore } from "./trial-store.js";

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

function personalizationKey(input) {
  const context = scheduleContext(input, input?.university);
  const year = academicYearStorageSegment(context.academicYear);
  const semester = Number(context.semester);
  if (!SAFE_SEGMENT.test(String(context.university || ""))
      || !SAFE_SEGMENT.test(String(context.program || ""))
      || !Number.isInteger(context.course) || context.course < 1
      || !context.groupId || !year || ![1, 2].includes(semester)) {
    const error = new Error("Incomplete schedule personalization context");
    error.code = "schedule_personalization_context_invalid";
    throw error;
  }
  return `schedule-personalization/${context.university}/${context.program}/${context.course}/${year}/semester-${semester}/${encodeURIComponent(context.groupId)}.json`;
}

export class FunnelAnalyticsStore extends TrialEnabledStore {
  async getSchedule(input) {
    const schedule = await super.getSchedule(input);
    if (!schedule) return null;
    if (!input?.preferences?.electives || !Object.keys(input.preferences.electives).length) return schedule;
    const catalog = await this.getSchedulePersonalization(input, schedule);
    const projected = projectScheduleForSubscription(schedule, input, catalog);
    return postprocessSchedule(projected);
  }

  async getSchedulePersonalization(input, schedule = null) {
    const catalog = await this.#readJson(personalizationKey(input));
    if (!catalog) return null;
    if (schedule && !schedulePersonalizationMatchesSchedule(schedule, catalog)) return null;
    return catalog;
  }

  async putSchedulePersonalization(input, catalog) {
    if (catalog?.version !== 1 || !Array.isArray(catalog?.electives) || !catalog?.baseSchedule) {
      const error = new Error("Invalid or unbound schedule personalization catalog");
      error.code = "schedule_personalization_invalid";
      throw error;
    }
    await this.#writeJson(personalizationKey(input), catalog);
  }

  async listFunnelOrders() {
    return this.#listJson("orders/", /^[A-Za-z0-9_-]{32}\.json$/);
  }

  async listTrialConversions() {
    return this.#listJson("trial-conversions/", /^[a-f0-9]{64}\.json$/);
  }

  async putFunnelRecord(recordKeyHash, value) {
    if (!SHA256.test(String(recordKeyHash || ""))) throw new Error("Invalid funnel record key");
    await this.#writeJson(`funnel-events/${recordKeyHash}.json`, value);
  }

  async getFunnelRecord(recordKeyHash) {
    if (!SHA256.test(String(recordKeyHash || ""))) return null;
    return this.#readJson(`funnel-events/${recordKeyHash}.json`);
  }

  async listFunnelEvents() {
    return this.#listJson("funnel-events/", /^[a-f0-9]{64}\.json$/);
  }

  async #listJson(prefix, filenamePattern) {
    const values = [];
    if (this.s3) {
      let continuationToken;
      do {
        const response = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const object of response.Contents || []) {
          const key = String(object.Key || "");
          const filename = key.slice(prefix.length);
          if (!filenamePattern.test(filename)) continue;
          const value = await this.#readJson(key);
          if (value) values.push(value);
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return values;
    }

    const directory = path.join(this.config.dataDir, prefix);
    let names = [];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const name of names.filter((value) => filenamePattern.test(value))) {
      const value = await this.#readJson(`${prefix}${name}`);
      if (value) values.push(value);
    }
    return values;
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

  async #writeJson(key, value) {
    const body = JSON.stringify(value);
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
