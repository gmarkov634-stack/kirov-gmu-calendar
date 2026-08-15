import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { YearAwareStore } from "./year-aware-store.js";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

export class TrialEnabledStore extends YearAwareStore {
  async putTrialConversion(conversionId, value) {
    if (!TOKEN.test(String(conversionId || ""))) throw new Error("Invalid trial conversion id");
    await this.putTrialConversionByHash(hash(conversionId), value);
  }

  async getTrialConversion(conversionId) {
    if (!TOKEN.test(String(conversionId || ""))) return null;
    return this.getTrialConversionByHash(hash(conversionId));
  }

  async putTrialConversionByHash(conversionHash, value) {
    if (!SHA256.test(String(conversionHash || ""))) throw new Error("Invalid trial conversion hash");
    await this.#writeTrialJson(`trial-conversions/${conversionHash}.json`, value);
  }

  async getTrialConversionByHash(conversionHash) {
    if (!SHA256.test(String(conversionHash || ""))) return null;
    return this.#readTrialJson(`trial-conversions/${conversionHash}.json`);
  }

  async markTrialConversionUpgradedByHash(conversionHash, upgradedAt = new Date().toISOString()) {
    const current = await this.getTrialConversionByHash(conversionHash);
    if (!current) return null;
    if (current.status === "upgraded") return current;
    const updated = {
      ...current,
      status: "upgraded",
      upgradedAt,
    };
    await this.putTrialConversionByHash(conversionHash, updated);
    return updated;
  }

  async #readTrialJson(key) {
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }));
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

  async #writeTrialJson(key, value) {
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
