import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const STORAGE_KEY = "secure/vk/oauth-credentials.v1.json";
const AAD = Buffer.from("kgmu-calendar:vk-oauth-credentials:v1", "utf8");

function isMissingObject(error) {
  return error?.name === "NoSuchKey" || error?.Code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

function decodeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  for (const encoding of ["base64url", "base64", "hex"]) {
    try {
      const key = Buffer.from(raw, encoding);
      if (key.length === 32) return key;
    } catch {
      // Try the next accepted encoding.
    }
  }
  return null;
}

function validateCredentials(value) {
  if (!value || typeof value !== "object") throw new Error("vk_oauth_credentials_invalid");
  const accessToken = String(value.accessToken || "");
  const refreshToken = String(value.refreshToken || "");
  const deviceId = String(value.deviceId || "");
  const expiresAt = Number(value.expiresAt || 0);
  if (!accessToken || !refreshToken || !deviceId || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error("vk_oauth_credentials_invalid");
  }
  return {
    version: 1,
    accessToken,
    refreshToken,
    deviceId,
    expiresAt,
    userId: Number(value.userId || 0) || null,
    scope: String(value.scope || ""),
    obtainedAt: String(value.obtainedAt || new Date().toISOString()),
  };
}

export class VkTokenVault {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.key = decodeKey(dependencies.encryptionKey ?? process.env.VK_OAUTH_ENCRYPTION_KEY);
    this.s3 = dependencies.s3 || (config.accessKeyId && config.secretAccessKey
      ? new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        })
      : null);
  }

  get enabled() {
    return Boolean(this.key);
  }

  async put(credentials) {
    if (!this.key) throw new Error("vk_oauth_vault_not_configured");
    const normalized = validateCredentials(credentials);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(AAD);
    const plaintext = Buffer.from(JSON.stringify(normalized), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = {
      version: 1,
      alg: "A256GCM",
      iv: iv.toString("base64url"),
      tag: tag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      updatedAt: new Date().toISOString(),
    };
    await this.#write(JSON.stringify(envelope));
    return { updatedAt: envelope.updatedAt };
  }

  async get() {
    if (!this.key) throw new Error("vk_oauth_vault_not_configured");
    const body = await this.#read();
    if (!body) return null;
    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      throw new Error("vk_oauth_vault_corrupt");
    }
    if (envelope?.version !== 1 || envelope?.alg !== "A256GCM") throw new Error("vk_oauth_vault_corrupt");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
      return validateCredentials(JSON.parse(plaintext));
    } catch {
      throw new Error("vk_oauth_vault_decrypt_failed");
    }
  }

  async #read() {
    if (this.s3) {
      try {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: STORAGE_KEY }));
        return response.Body.transformToString("utf8");
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    }
    try {
      return await fs.readFile(path.join(this.config.dataDir, STORAGE_KEY), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async #write(body) {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: STORAGE_KEY,
        Body: body,
        ContentType: "application/json; charset=utf-8",
        CacheControl: "no-store",
        Metadata: { purpose: "vk-oauth-encrypted" },
      }));
      return;
    }
    const filename = path.join(this.config.dataDir, STORAGE_KEY);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body, { mode: 0o600 });
  }
}

export const VK_TOKEN_VAULT_STORAGE_KEY = STORAGE_KEY;
