import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const GROUPS = ["131", "132", "133", "134", "135", "136", "137", "138", "139"];

function isValidGroup(group) {
  return GROUPS.includes(String(group));
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

export class ScheduleStore {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.s3 = config.accessKeyId && config.secretAccessKey
      ? new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        })
      : null;
  }

  listGroups() {
    return GROUPS.map((group) => ({
      group,
      faculty: "pediatrics",
      course: 1,
      status: "configured",
    }));
  }

  async get(group) {
    group = String(group);
    if (!isValidGroup(group)) return null;
    const cached = this.cache.get(group);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let value;
    if (this.s3) {
      const response = await this.s3.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: `schedules/pediatrics/1/${group}.json`,
      }));
      value = JSON.parse(await response.Body.transformToString("utf8"));
    } else {
      const filename = path.join(this.config.dataDir, "schedules", "pediatrics", "1", `${group}.json`);
      try {
        value = JSON.parse(await fs.readFile(filename, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    }
    this.cache.set(group, { value, expiresAt: Date.now() + this.config.cacheTtlMs });
    return value;
  }

  async getSubscription(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = tokenHash(token);
    const cacheKey = `subscription:${hash}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let value;
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: `subscriptions/${hash}.json`,
        }));
        value = JSON.parse(await response.Body.transformToString("utf8"));
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    } else {
      const filename = path.join(this.config.dataDir, "subscriptions", `${hash}.json`);
      try {
        value = JSON.parse(await fs.readFile(filename, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    }
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.config.cacheTtlMs });
    return value;
  }
}
