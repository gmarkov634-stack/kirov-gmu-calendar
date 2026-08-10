import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ScheduleStore } from "./store.js";
import { scheduleContext, scheduleStorageKey } from "./order-context.js";

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

export class MultiUniversityStore extends ScheduleStore {
  async getSchedule(input) {
    const context = scheduleContext(input);
    const key = scheduleStorageKey(context);
    const cacheKey = `schedule:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let value;
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }));
        value = JSON.parse(await response.Body.transformToString("utf8"));
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    } else {
      try {
        value = JSON.parse(await fs.readFile(path.join(this.config.dataDir, key), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    }

    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
    return value;
  }

  async listScheduleGroups(input) {
    const context = scheduleContext(input);
    if (!context.university || !context.program || !Number.isInteger(context.course) || context.course < 1) {
      throw new Error("Incomplete schedule context");
    }

    const prefix = `schedules/${context.university}/${context.program}/${context.course}/`;
    const groups = new Map();
    const addKey = (key) => {
      if (typeof key !== "string" || !key.startsWith(prefix)) return;
      const filename = key.slice(prefix.length);
      if (!filename || filename.includes("/")) return;
      const group = scheduleGroupFromFilename(filename);
      if (group) groups.set(group.groupId, group);
    };

    if (this.s3) {
      let continuationToken;
      do {
        const response = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const object of response.Contents || []) addKey(object.Key || "");
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
    } else {
      const directory = path.join(this.config.dataDir, prefix);
      let names = [];
      try {
        names = await fs.readdir(directory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      for (const name of names) addKey(`${prefix}${name}`);
    }

    return [...groups.values()].sort((a, b) =>
      a.groupCode.localeCompare(b.groupCode, "ru", { numeric: true, sensitivity: "base" }),
    );
  }
}
