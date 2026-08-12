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

function normalizedKeyAllowed(key) {
  return /^parser-staging\/kgmu\/normalized\/[a-f0-9]{64}\.json$/.test(String(key || ""));
}

function sourceKeyAllowed(key) {
  return /^parser-staging\/kgmu\/sources\/[a-f0-9]{64}\/[A-Za-z0-9._-]{1,120}$/.test(String(key || ""));
}

export class ParserReviewQueue {
  constructor(config) {
    this.config = config;
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

  async storeSource(buffer, sha256, filename) {
    const safeName = String(filename || "schedule.xlsx").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "schedule.xlsx";
    const key = `parser-staging/kgmu/sources/${sha256}/${safeName}`;
    await this.#writeRaw(key, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return key;
  }

  async getSource(key) {
    if (!sourceKeyAllowed(key)) return null;
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        const bytes = await response.Body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    }
    try {
      return await fs.readFile(path.join(this.config.dataDir, key));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async storeNormalized(sourceSha256, value) {
    if (!/^[a-f0-9]{64}$/.test(String(sourceSha256 || ""))) throw new Error("Invalid source SHA-256");
    const key = `parser-staging/kgmu/normalized/${sourceSha256}.json`;
    await this.#writeJson(key, value);
    return key;
  }

  async getNormalized(key) {
    if (!normalizedKeyAllowed(key)) return null;
    return this.#readJson(key);
  }

  async createReview(value) {
    const reviewId = randomUUID();
    const now = new Date().toISOString();
    const item = {
      version: 1,
      reviewId,
      university: "kgmu",
      status: "REVIEW_REQUIRED",
      createdAt: now,
      updatedAt: now,
      ...value,
    };
    await this.#writeJson(`parser-reviews/kgmu/${reviewId}.json`, item);
    return item;
  }

  async updateReview(reviewId, patch) {
    if (!validReviewId(reviewId)) return null;
    const key = `parser-reviews/kgmu/${reviewId}.json`;
    const current = await this.#readJson(key);
    if (!current) return null;
    const updated = {
      ...current,
      ...patch,
      reviewId: current.reviewId,
      version: current.version,
      university: current.university,
      updatedAt: new Date().toISOString(),
    };
    await this.#writeJson(key, updated);
    return updated;
  }

  async getReview(reviewId) {
    if (!validReviewId(reviewId)) return null;
    return this.#readJson(`parser-reviews/kgmu/${reviewId}.json`);
  }

  async listReviews({ status, limit = 100 } = {}) {
    const keys = await this.#listKeys("parser-reviews/kgmu/");
    const items = [];
    for (const key of keys.filter((key) => key.endsWith(".json")).slice(-Math.max(1, Math.min(Number(limit) || 100, 500)))) {
      const item = await this.#readJson(key);
      if (!item) continue;
      if (status && item.status !== status) continue;
      items.push(item);
    }
    return items.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  async #listKeys(prefix) {
    if (this.s3) {
      const keys = [];
      let continuationToken;
      do {
        const response = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        for (const item of response.Contents || []) if (item.Key) keys.push(item.Key);
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    }
    const directory = path.join(this.config.dataDir, prefix);
    let names = [];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return names.map((name) => `${prefix}${name}`);
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
    return this.#writeRaw(key, Buffer.from(JSON.stringify(value)), "application/json; charset=utf-8");
  }

  async #writeRaw(key, body, contentType) {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "no-store",
      }));
      return;
    }
    const filename = path.join(this.config.dataDir, key);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body, { mode: 0o600 });
  }
}
