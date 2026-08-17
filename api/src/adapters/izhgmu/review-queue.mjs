import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function missing(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

function validReviewId(value) {
  return /^[a-f0-9-]{36}$/.test(String(value || ""));
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ""));
}

export class IzhgmuReviewQueue {
  constructor(config) {
    this.config = config;
    this.s3 = config.accessKeyId && config.secretAccessKey
      ? new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          forcePathStyle: true,
          credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        })
      : null;
  }

  async createSourceSetReview(value) {
    const digest = String(value?.sourceSet?.digest || "").toLowerCase();
    if (!validDigest(digest) || !Array.isArray(value?.sourceSet?.members) || !value.sourceSet.members.length) {
      throw Object.assign(new Error("Invalid IzhGMU source set"), { code: "IZHGMU_SOURCE_SET_INVALID" });
    }
    const existing = (await this.listReviews({ limit: 500 })).find((item) =>
      item.sourceSet?.digest === digest && item.metadata?.academicYear === value.metadata?.academicYear && item.metadata?.semester === value.metadata?.semester,
    );
    if (existing) return existing;
    const reviewId = randomUUID();
    const now = new Date().toISOString();
    const item = {
      version: 1,
      reviewId,
      university: "izhgmu",
      status: "REVIEW_REQUIRED",
      createdAt: now,
      updatedAt: now,
      publicationBlocked: true,
      currentPublishedSchedulePreserved: true,
      ...value,
      sourceSet: { ...value.sourceSet, digest },
    };
    await this.#writeJson(`parser-reviews/izhgmu/${reviewId}.json`, item);
    return item;
  }

  async storeNormalized(sourceSetDigest, value) {
    if (!validDigest(sourceSetDigest)) throw new Error("Invalid source-set SHA-256");
    const key = `parser-staging/izhgmu/normalized/${sourceSetDigest}.json`;
    await this.#writeJson(key, value);
    return key;
  }

  async getNormalized(key) {
    if (!/^parser-staging\/izhgmu\/normalized\/[a-f0-9]{64}\.json$/.test(String(key || ""))) return null;
    return this.#readJson(key);
  }

  async getReview(reviewId) {
    if (!validReviewId(reviewId)) return null;
    return this.#readJson(`parser-reviews/izhgmu/${reviewId}.json`);
  }

  async updateReview(reviewId, patch) {
    const current = await this.getReview(reviewId);
    if (!current) return null;
    const updated = {
      ...current,
      ...patch,
      reviewId: current.reviewId,
      version: current.version,
      university: "izhgmu",
      sourceSet: current.sourceSet,
      updatedAt: new Date().toISOString(),
    };
    await this.#writeJson(`parser-reviews/izhgmu/${reviewId}.json`, updated);
    return updated;
  }

  async listReviews({ status, limit = 100 } = {}) {
    const keys = await this.#listKeys("parser-reviews/izhgmu/");
    const items = [];
    for (const key of keys.filter((key) => key.endsWith(".json")).slice(-Math.max(1, Math.min(Number(limit) || 100, 500)))) {
      const item = await this.#readJson(key);
      if (!item || (status && item.status !== status)) continue;
      items.push(item);
    }
    return items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  async #listKeys(prefix) {
    if (this.s3) {
      const keys = [];
      let continuationToken;
      do {
        const response = await this.s3.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, ContinuationToken: continuationToken }));
        for (const item of response.Contents || []) if (item.Key) keys.push(item.Key);
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    }
    try {
      return (await fs.readdir(path.join(this.config.dataDir, prefix))).map((name) => `${prefix}${name}`);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async #readJson(key) {
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        return JSON.parse(await response.Body.transformToString("utf8"));
      } catch (error) {
        if (missing(error)) return null;
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
    const body = Buffer.from(JSON.stringify(value));
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: "application/json; charset=utf-8", CacheControl: "no-store" }));
      return;
    }
    const filename = path.join(this.config.dataDir, key);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body, { mode: 0o600 });
  }
}
