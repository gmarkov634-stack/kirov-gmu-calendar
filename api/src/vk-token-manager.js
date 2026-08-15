import { randomBytes } from "node:crypto";

const APP_ID = 54722093;
const REDIRECT_URL = "https://kgmu-calendar-api.containerapps.ru/api/v1/vk/oauth/callback";
const TOKEN_URL = "https://id.vk.ru/oauth2/auth";
const REFRESH_SKEW_MS = 2 * 60 * 1000;

function normalizedTokenResult(result, deviceId, now) {
  const accessToken = String(result?.access_token || "");
  const refreshToken = String(result?.refresh_token || "");
  const expiresIn = Number(result?.expires_in || 0);
  if (!accessToken || !refreshToken || !deviceId || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("vk_oauth_token_result_invalid");
  }
  return {
    accessToken,
    refreshToken,
    deviceId: String(deviceId),
    expiresAt: now + expiresIn * 1000,
    userId: Number(result?.user_id || 0) || null,
    scope: String(result?.scope || ""),
    obtainedAt: new Date(now).toISOString(),
  };
}

export class VkTokenManager {
  constructor({ vault, env = process.env, fetchImpl = globalThis.fetch, nowFactory = Date.now } = {}) {
    this.vault = vault;
    this.staticToken = String(env.VK_USER_ACCESS_TOKEN || "").trim();
    this.fetchImpl = fetchImpl;
    this.nowFactory = nowFactory;
    this.refreshPromise = null;
  }

  get configured() {
    return Boolean(this.staticToken || this.vault?.enabled);
  }

  get persistentOAuthEnabled() {
    return Boolean(this.vault?.enabled);
  }

  async saveAuthorizationResult(result, deviceId) {
    if (!this.vault?.enabled) throw new Error("vk_oauth_vault_not_configured");
    const credentials = normalizedTokenResult(result, deviceId, this.nowFactory());
    await this.vault.put(credentials);
    return {
      expiresAt: credentials.expiresAt,
      userId: credentials.userId,
      scope: credentials.scope,
    };
  }

  async getAccessToken() {
    if (this.staticToken) return this.staticToken;
    if (!this.vault?.enabled) throw new Error("vk_oauth_vault_not_configured");
    const credentials = await this.vault.get();
    if (!credentials) throw new Error("vk_oauth_credentials_missing");
    if (credentials.expiresAt > this.nowFactory() + REFRESH_SKEW_MS) return credentials.accessToken;

    if (!this.refreshPromise) {
      this.refreshPromise = this.#refresh(credentials).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async #refresh(credentials) {
    const state = randomBytes(24).toString("base64url");
    const url = new URL(TOKEN_URL);
    url.searchParams.set("grant_type", "refresh_token");
    url.searchParams.set("redirect_uri", REDIRECT_URL);
    url.searchParams.set("client_id", String(APP_ID));
    url.searchParams.set("device_id", credentials.deviceId);
    url.searchParams.set("state", state);

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: credentials.refreshToken }),
    });
    if (!response.ok) throw new Error(`vk_oauth_refresh_http_${response.status}`);
    const result = await response.json();
    if (result?.error) throw new Error("vk_oauth_refresh_rejected");
    if (String(result?.state || "") !== state) throw new Error("vk_oauth_refresh_state_mismatch");

    const rotated = normalizedTokenResult(result, credentials.deviceId, this.nowFactory());
    await this.vault.put(rotated);
    return rotated.accessToken;
  }
}

export const VK_TOKEN_MANAGER_CONFIG = Object.freeze({
  appId: APP_ID,
  redirectUrl: REDIRECT_URL,
  tokenUrl: TOKEN_URL,
  refreshSkewMs: REFRESH_SKEW_MS,
});
