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

function safePdfName(value) {
  const name = String(value || "schedule.pdf").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "schedule.pdf";
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

function sourceKeyAllowed(key) {
  return /^parser-staging\/omgmu\/sources\/[a-f0-9]{64}\/[A-Za-z0-9._-]{1,124}$/.test(String(key || ""));
}

export class OmgmuReviewQueue {
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

  async storeSource(buffer, sha256, filename) {
    if (!/^[a-f0-9]{64}$/.test(String(sha256 || ""))) throw new Error("Invalid source SHA-256");
    const key = `parser-staging/omgmu/sources/${sha256}/${safePdfName(filename)}`;
    await this.#writeRaw(key, Buffer.from(buffer), "application/pdf");
    return key;
  }

  async getSource(key) {
    if (!sourceKeyAllowed(key)) return null;
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        return Buffer.from(await response.Body.transformToByteArray());
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

  async createReview(value) {
    const reviewId = randomUUID();
    const now = new Date().toISOString();
    const item = {
      version: 1,
      reviewId,
      university: "omgmu",
      status: "REVIEW_REQUIRED",
      createdAt: now,
      updatedAt: now,
      ...value,
    };
    await this.#writeJson(`parser-reviews/omgmu/${reviewId}.json`, item);
    return item;
  }

  async getReview(reviewId) {
    if (!validReviewId(reviewId)) return null;
    return this.#readJson(`parser-reviews/omgmu/${reviewId}.json`);
  }

  async listReviews({ status, limit = 100 } = {}) {
    const keys = await this.#listKeys("parser-reviews/omgmu/");
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
    try {
      return (await fs.readdir(directory)).map((name) => `${prefix}${name}`);
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
