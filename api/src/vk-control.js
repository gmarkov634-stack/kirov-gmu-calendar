import { createPublicKey, verify as verifySignature } from "node:crypto";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const EXPECTED_AUDIENCE = "kgmu-vk-control";
const EXPECTED_REPOSITORY = "gmarkov634-stack/kirov-gmu-calendar";
const EXPECTED_ACTOR = "gmarkov634-stack";
const DEFAULT_API_VERSION = "5.199";
const MAX_BODY_BYTES = 32768;
const MAX_COMMAND_AGE_MS = 30 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 16000;
const MAX_GROUP_DESCRIPTION_LENGTH = 10000;
const MAX_GROUP_WEBSITE_LENGTH = 2048;
const COMMUNITY_TOKEN_ACTIONS = new Set(["wall.post", "group.info", "group.edit"]);
const UNSUPPORTED_WALL_ACTIONS = new Set(["wall.pin", "wall.unpin"]);
const GROUP_EDIT_ALLOWED_FIELDS = new Set(["description", "website"]);

let jwksCache = { expiresAt: 0, keys: [] };

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function decodeBase64Url(value) {
  return Buffer.from(String(value), "base64url");
}

function parseJwtPart(value) {
  return JSON.parse(decodeBase64Url(value).toString("utf8"));
}

function audienceMatches(value) {
  if (Array.isArray(value)) return value.includes(EXPECTED_AUDIENCE);
  return value === EXPECTED_AUDIENCE;
}

async function githubJwks(fetchImpl) {
  if (jwksCache.expiresAt > Date.now() && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetchImpl(GITHUB_JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("oidc_jwks_unavailable");
  const data = await response.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (!keys.length) throw new Error("oidc_jwks_empty");
  jwksCache = { expiresAt: Date.now() + 5 * 60 * 1000, keys };
  return keys;
}

export async function verifyGitHubOidcToken(token, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("oidc_invalid_token");

  let header;
  let claims;
  try {
    header = parseJwtPart(parts[0]);
    claims = parseJwtPart(parts[1]);
  } catch {
    throw new Error("oidc_invalid_token");
  }
  if (header?.alg !== "RS256" || typeof header?.kid !== "string") throw new Error("oidc_invalid_header");

  const keys = await githubJwks(fetchImpl);
  const jwk = keys.find((key) => key?.kid === header.kid && key?.kty === "RSA");
  if (!jwk) throw new Error("oidc_unknown_key");

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);
  const valid = verifySignature("RSA-SHA256", signingInput, createPublicKey({ key: jwk, format: "jwk" }), signature);
  if (!valid) throw new Error("oidc_invalid_signature");

  const nowSeconds = Math.floor(now / 1000);
  if (claims?.iss !== GITHUB_OIDC_ISSUER || !audienceMatches(claims?.aud)) throw new Error("oidc_invalid_claims");
  if (!Number.isFinite(Number(claims?.exp)) || Number(claims.exp) < nowSeconds - 30) throw new Error("oidc_expired");
  if (Number.isFinite(Number(claims?.nbf)) && Number(claims.nbf) > nowSeconds + 30) throw new Error("oidc_not_yet_valid");
  if (claims?.repository !== EXPECTED_REPOSITORY || claims?.actor !== EXPECTED_ACTOR) throw new Error("oidc_forbidden_identity");
  if (claims?.event_name !== "pull_request") throw new Error("oidc_forbidden_event");
  if (typeof claims?.ref !== "string" || !/^refs\/pull\/\d+\/merge$/.test(claims.ref)) throw new Error("oidc_forbidden_ref");
  return claims;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("request_too_large");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("invalid_json");
  }
}

function bearerToken(request) {
  const value = String(request.headers?.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function validCommand(input, now) {
  if (!input || typeof input !== "object") return null;
  const id = String(input.id || "").trim();
  const action = String(input.action || "").trim();
  const createdAt = Date.parse(input.createdAt);
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(id)) return null;
  if (!Number.isFinite(createdAt) || Math.abs(now - createdAt) > MAX_COMMAND_AGE_MS) return null;
  return { id, action, createdAt: new Date(createdAt).toISOString(), payload: input.payload || {} };
}

function cleanMessage(value) {
  const message = String(value ?? "");
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error("message_too_long");
  return message;
}

function cleanAttachments(value) {
  if (value == null || value === "") return "";
  const attachments = Array.isArray(value) ? value.join(",") : String(value);
  if (attachments.length > 4000 || !/^[A-Za-z0-9_,-]*$/.test(attachments)) throw new Error("invalid_attachments");
  return attachments;
}

function positivePostId(value) {
  const postId = Number(value);
  if (!Number.isInteger(postId) || postId <= 0) throw new Error("invalid_post_id");
  return postId;
}

function cleanGroupEditPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_group_edit_payload");
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !GROUP_EDIT_ALLOWED_FIELDS.has(key))) {
    throw new Error("invalid_group_edit_payload");
  }

  const fields = {};
  if (Object.hasOwn(value, "description")) {
    if (typeof value.description !== "string" || value.description.length > MAX_GROUP_DESCRIPTION_LENGTH) {
      throw new Error("invalid_group_description");
    }
    fields.description = value.description;
  }
  if (Object.hasOwn(value, "website")) {
    if (typeof value.website !== "string" || value.website.length > MAX_GROUP_WEBSITE_LENGTH) {
      throw new Error("invalid_group_website");
    }
    const website = value.website.trim();
    if (website) {
      let url;
      try {
        url = new URL(website);
      } catch {
        throw new Error("invalid_group_website");
      }
      if (url.protocol !== "https:") throw new Error("invalid_group_website");
    }
    fields.website = website;
  }
  return fields;
}

function bestPhotoUrl(photo) {
  const sizes = Array.isArray(photo?.sizes) ? photo.sizes : [];
  return [...sizes]
    .filter((item) => typeof item?.url === "string" && item.url)
    .sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0))[0]?.url || null;
}

function sanitizeAttachment(attachment) {
  const type = String(attachment?.type || "unknown");
  if (type === "photo") return {
    type,
    id: Number(attachment.photo?.id || 0),
    ownerId: Number(attachment.photo?.owner_id || 0),
    text: String(attachment.photo?.text || ""),
    imageUrl: bestPhotoUrl(attachment.photo),
  };
  if (type === "link") return {
    type,
    title: String(attachment.link?.title || ""),
    description: String(attachment.link?.description || ""),
    url: typeof attachment.link?.url === "string" ? attachment.link.url : null,
  };
  if (type === "doc") return {
    type,
    id: Number(attachment.doc?.id || 0),
    ownerId: Number(attachment.doc?.owner_id || 0),
    title: String(attachment.doc?.title || ""),
    ext: String(attachment.doc?.ext || ""),
  };
  if (type === "video") return {
    type,
    id: Number(attachment.video?.id || 0),
    ownerId: Number(attachment.video?.owner_id || 0),
    title: String(attachment.video?.title || ""),
  };
  return { type };
}

function sanitizePost(post) {
  const timestamp = Number(post?.date || 0);
  return {
    id: Number(post?.id || 0),
    date: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null,
    text: String(post?.text || ""),
    isPinned: Number(post?.is_pinned || 0) === 1,
    comments: Number(post?.comments?.count || 0),
    likes: Number(post?.likes?.count || 0),
    reposts: Number(post?.reposts?.count || 0),
    views: Number(post?.views?.count || 0),
    attachments: Array.isArray(post?.attachments) ? post.attachments.map(sanitizeAttachment) : [],
  };
}

function sanitizeGroup(group) {
  return {
    id: Number(group?.id || 0),
    name: String(group?.name || ""),
    screenName: String(group?.screen_name || ""),
    type: String(group?.type || ""),
    isClosed: Number(group?.is_closed || 0),
    description: String(group?.description || ""),
    website: String(group?.site || group?.website || ""),
    activity: String(group?.activity || ""),
    status: String(group?.status || ""),
    membersCount: Number(group?.members_count || 0),
    verified: Number(group?.verified || 0) === 1,
    city: group?.city && typeof group.city === "object"
      ? { id: Number(group.city.id || 0), title: String(group.city.title || "") }
      : null,
    country: group?.country && typeof group.country === "object"
      ? { id: Number(group.country.id || 0), title: String(group.country.title || "") }
      : null,
  };
}

async function vkMethod({ method, token, apiVersion, params, fetchImpl }) {
  const body = new URLSearchParams({ access_token: token, v: apiVersion, ...params });
  const response = await fetchImpl(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`vk_http_${response.status}`);
  const result = await response.json();
  if (result?.error) {
    const error = new Error("vk_api_error");
    error.vkCode = Number(result.error.error_code || 0);
    throw error;
  }
  return result?.response;
}

async function executeCommand(command, { groupId, token, apiVersion, fetchImpl }) {
  const ownerId = `-${groupId}`;
  if (command.action === "wall.list") {
    const result = await vkMethod({
      method: "wall.get",
      token,
      apiVersion,
      fetchImpl,
      params: { owner_id: ownerId, count: "20", filter: "owner", extended: "0" },
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    return { total: Number(result?.count || items.length), posts: items.map(sanitizePost) };
  }

  if (command.action === "group.info") {
    const result = await vkMethod({
      method: "groups.getById",
      token,
      apiVersion,
      fetchImpl,
      params: {
        group_ids: groupId,
        fields: "description,site,activity,status,members_count,verified,city,country",
      },
    });
    const groups = Array.isArray(result?.groups) ? result.groups : (Array.isArray(result) ? result : []);
    const group = groups.find((item) => Number(item?.id || 0) === Number(groupId)) || groups[0];
    if (!group) throw new Error("vk_group_not_found");
    return sanitizeGroup(group);
  }

  if (command.action === "group.edit") {
    const fields = cleanGroupEditPayload(command.payload);
    const result = await vkMethod({
      method: "groups.edit",
      token,
      apiVersion,
      fetchImpl,
      params: { group_id: groupId, ...fields },
    });
    return { updated: Number(result || 0) === 1, fields: Object.keys(fields) };
  }

  if (command.action === "wall.post") {
    const message = cleanMessage(command.payload?.message);
    const attachments = cleanAttachments(command.payload?.attachments);
    if (!message.trim() && !attachments) throw new Error("empty_post");
    const result = await vkMethod({
      method: "wall.post",
      token,
      apiVersion,
      fetchImpl,
      params: {
        owner_id: ownerId,
        from_group: "1",
        message,
        ...(attachments ? { attachments } : {}),
        guid: command.id,
      },
    });
    return { postId: Number(result?.post_id || 0) };
  }

  if (command.action === "wall.edit") {
    const postId = positivePostId(command.payload?.postId);
    const message = cleanMessage(command.payload?.message);
    const attachments = cleanAttachments(command.payload?.attachments);
    const result = await vkMethod({
      method: "wall.edit",
      token,
      apiVersion,
      fetchImpl,
      params: {
        owner_id: ownerId,
        post_id: String(postId),
        message,
        ...(attachments ? { attachments } : {}),
      },
    });
    return { postId, edited: Number(result || 0) === 1 };
  }

  if (["wall.delete", "wall.pin", "wall.unpin"].includes(command.action)) {
    const postId = positivePostId(command.payload?.postId);
    const method = command.action;
    const result = await vkMethod({
      method,
      token,
      apiVersion,
      fetchImpl,
      params: { owner_id: ownerId, post_id: String(postId) },
    });
    return { postId, success: Number(result || 0) === 1 };
  }

  throw new Error("unsupported_action");
}

export function createVkControlHandler(env = process.env, dependencies = {}) {
  const groupId = String(env.VK_CALLBACK_GROUP_ID || "").trim();
  const staticAccessToken = String(env.VK_USER_ACCESS_TOKEN || "").trim();
  const communityAccessToken = String(env.VK_ACCESS_TOKEN || "").trim();
  const tokenManager = dependencies.tokenManager || null;
  const apiVersion = String(env.VK_API_VERSION || DEFAULT_API_VERSION).trim();
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const verifyOidcToken = dependencies.verifyOidcToken || ((token) => verifyGitHubOidcToken(token, { fetchImpl }));
  const nowFactory = dependencies.nowFactory || Date.now;

  return async function handleVkControl(request, response) {
    if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
    const managedConfigured = Boolean(tokenManager?.configured);
    if (!/^\d+$/.test(groupId)) {
      return sendJson(response, 503, { error: "vk_control_not_configured" });
    }

    try {
      const authToken = bearerToken(request);
      if (!authToken) return sendJson(response, 401, { error: "unauthorized" });
      try {
        await verifyOidcToken(authToken);
      } catch (error) {
        console.error("vk control auth rejected", error?.message || "unknown");
        return sendJson(response, 403, { error: "forbidden" });
      }

      const input = await readJson(request);
      const command = validCommand(input, nowFactory());
      if (!command) return sendJson(response, 400, { error: "invalid_command" });
      if (command.action === "wall.delete") {
        return sendJson(response, 501, { error: "vk_wall_delete_not_supported" });
      }
      if (UNSUPPORTED_WALL_ACTIONS.has(command.action)) {
        return sendJson(response, 501, { error: "vk_wall_pin_not_supported" });
      }

      let accessToken;
      if (COMMUNITY_TOKEN_ACTIONS.has(command.action)) {
        if (!communityAccessToken) return sendJson(response, 503, { error: "vk_control_not_configured" });
        accessToken = communityAccessToken;
      } else {
        if (!staticAccessToken && !managedConfigured) {
          return sendJson(response, 503, { error: "vk_control_not_configured" });
        }
        accessToken = managedConfigured
          ? await tokenManager.getAccessToken()
          : staticAccessToken;
      }

      const result = await executeCommand(command, {
        groupId,
        token: accessToken,
        apiVersion,
        fetchImpl,
      });
      console.log("vk control command completed", { id: command.id, action: command.action });
      return sendJson(response, 200, {
        ok: true,
        id: command.id,
        action: command.action,
        result,
      });
    } catch (error) {
      if ([
        "invalid_json",
        "request_too_large",
        "message_too_long",
        "invalid_attachments",
        "invalid_post_id",
        "empty_post",
        "invalid_group_edit_payload",
        "invalid_group_description",
        "invalid_group_website",
        "unsupported_action",
        "vk_group_not_found",
      ].includes(error?.message)) {
        return sendJson(response, 400, { error: error.message });
      }
      if (["vk_oauth_vault_not_configured", "vk_oauth_credentials_missing"].includes(error?.message)) {
        return sendJson(response, 503, { error: "vk_control_not_configured" });
      }
      if (error?.message === "vk_api_error") {
        console.error("vk control VK API error", { code: error.vkCode || 0 });
        return sendJson(response, 502, { error: "vk_api_error", code: error.vkCode || 0 });
      }
      console.error("vk control failed", error?.message || "unknown");
      return sendJson(response, 502, { error: "vk_control_unavailable" });
    }
  };
}
