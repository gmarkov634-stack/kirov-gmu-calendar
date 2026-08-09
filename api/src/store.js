import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const GROUPS = ["131", "132", "133", "134", "135", "136", "137", "138", "139"];

function isValidGroup(group) {
  return GROUPS.includes(String(group));
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isValidTokenHash(hash) {
  return /^[a-f0-9]{64}$/.test(hash);
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

  async getOrder(orderId) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(orderId)) return null;
    return this.#readJson(`orders/${orderId}.json`);
  }

  async putOrder(orderId, value) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(orderId)) throw new Error("Invalid order id");
    await this.#writeJson(`orders/${orderId}.json`, value);
  }

  async putSubscription(token, value) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid subscription token");
    const hash = tokenHash(token);
    await this.#writeJson(`subscriptions/${hash}.json`, value);
    this.cache.set(`subscription:${hash}`, {
      value,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
    const accessKey = `subscription-access/${hash}.json`;
    const record = await this.#readJson(accessKey);
    if (value.status === "active" && !record) {
      await this.#writeJson(accessKey, {
        version: 1,
        tokenHash: hash,
        orderId: value.orderId || null,
        group: String(value.group),
        status: value.status,
        issuedAt: value.createdAt || new Date().toISOString(),
        firstSeenAt: null,
        lastSeenAt: null,
        totalRequests: 0,
        suspicious: false,
        sourceCount: 0,
        sources: [],
      });
    } else if (value.status !== "active" && record) {
      await this.#writeJson(accessKey, { ...record, status: value.status, statusChangedAt: value.revokedAt });
    }
  }

  async recordSubscriptionAccess(token, subscription, observation) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid subscription token");
    const hash = tokenHash(token);
    const key = `subscription-access/${hash}.json`;
    const current = await this.#readJson(key);
    const cutoff = Date.parse(observation.seenAt) - 7 * 24 * 60 * 60 * 1000;
    const sources = (Array.isArray(current?.sources) ? current.sources : [])
      .filter((source) => Date.parse(source.lastSeenAt) >= cutoff);
    const existing = sources.find((source) => source.fingerprint === observation.fingerprint);
    if (existing) {
      existing.lastSeenAt = observation.seenAt;
      existing.count = Number(existing.count || 0) + 1;
    } else if (sources.length < 32) {
      sources.push({
        fingerprint: observation.fingerprint,
        client: observation.client,
        firstSeenAt: observation.seenAt,
        lastSeenAt: observation.seenAt,
        count: 1,
      });
    }
    const threshold = Math.max(2, Number(this.config.suspiciousSourceThreshold || 8));
    const value = {
      version: 1,
      tokenHash: hash,
      orderId: subscription.orderId || null,
      group: String(subscription.group),
      status: subscription.status,
      firstSeenAt: current?.firstSeenAt || observation.seenAt,
      lastSeenAt: observation.seenAt,
      totalRequests: Number(current?.totalRequests || 0) + 1,
      suspicious: sources.length >= threshold,
      sourceCount: sources.length,
      sources,
    };
    await this.#writeJson(key, value);
    return value;
  }

  async listSubscriptionAccess() {
    const records = [];
    if (this.s3) {
      let continuationToken;
      do {
        const response = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: "subscription-access/",
          ContinuationToken: continuationToken,
        }));
        for (const object of response.Contents || []) {
          if (object.Key?.endsWith(".json")) {
            const value = await this.#readJson(object.Key);
            if (value) records.push(value);
          }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
    } else {
      const directory = path.join(this.config.dataDir, "subscription-access");
      let names = [];
      try {
        names = await fs.readdir(directory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      for (const name of names.filter((value) => /^[a-f0-9]{64}\.json$/.test(value))) {
        const value = await this.#readJson(`subscription-access/${name}`);
        if (value) records.push(value);
      }
    }
    return records.sort((a, b) => String(b.lastSeenAt || b.issuedAt || "").localeCompare(String(a.lastSeenAt || a.issuedAt || "")));
  }

  async revokeSubscriptionByHash(hash) {
    if (!isValidTokenHash(hash)) throw new Error("Invalid subscription hash");
    const key = `subscriptions/${hash}.json`;
    const subscription = await this.#readJson(key);
    if (!subscription) return null;
    const revokedAt = new Date().toISOString();
    const updated = { ...subscription, status: "revoked", revokedAt };
    await this.#writeJson(key, updated);
    this.cache.set(`subscription:${hash}`, { value: updated, expiresAt: Date.now() + this.config.cacheTtlMs });
    const accessKey = `subscription-access/${hash}.json`;
    const record = await this.#readJson(accessKey);
    if (record) await this.#writeJson(accessKey, { ...record, status: "revoked", statusChangedAt: revokedAt });
    return updated;
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
