import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { ScheduleStore } from "./store.js";
import { scheduleContext, scheduleStorageKey } from "./order-context.js";

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
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
}
