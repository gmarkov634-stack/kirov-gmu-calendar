const DEFAULT_API_VERSION = "5.199";
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_COVER_RESPONSE_JSON_BYTES = 25000;
const PHOTO_SOURCE_HOST = "raw.githubusercontent.com";
const PHOTO_SOURCE_PREFIX = "/gmarkov634-stack/kirov-gmu-calendar/";
const COVER_CROP = Object.freeze({ x: 0, y: 65, x2: 1590, y2: 465 });

export const COMMUNITY_BRANDING_ACTIONS = new Set(["group.cover.set", "group.cover.probe", "group.branding.info"]);
export const BRANDING_ACTIONS = new Set([...COMMUNITY_BRANDING_ACTIONS, "group.cover.userProbe", "group.avatar.set"]);

function cleanPhotoSourceUrl(value) {
  const raw = String(value || "").trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error("invalid_photo_source_url"); }
  if (url.protocol !== "https:" || url.hostname !== PHOTO_SOURCE_HOST) throw new Error("invalid_photo_source_url");
  if (!url.pathname.startsWith(PHOTO_SOURCE_PREFIX) || !url.pathname.includes("/ops/vk/assets/")) throw new Error("invalid_photo_source_url");
  if (!/\.(?:jpe?g|png)$/i.test(url.pathname)) throw new Error("invalid_photo_source_url");
  if (url.search || url.hash) throw new Error("invalid_photo_source_url");
  return url.toString();
}

function photoContentType(buffer, declaredType = "") {
  const type = String(declaredType || "").split(";", 1)[0].trim().toLowerCase();
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (["image/jpeg", "image/png"].includes(type)) return type;
  throw new Error("invalid_photo_source_content");
}

async function vkMethod({ method, token, apiVersion = DEFAULT_API_VERSION, params, fetchImpl }) {
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

async function loadSource(sourceUrl, fetchImpl) {
  const cleanUrl = cleanPhotoSourceUrl(sourceUrl);
  const response = await fetchImpl(cleanUrl, {
    method: "GET",
    headers: { Accept: "image/jpeg,image/png" },
    redirect: "error",
  });
  if (!response.ok) throw new Error("photo_source_unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("invalid_photo_source_content");
  return { bytes, contentType: photoContentType(bytes, response.headers?.get?.("content-type")) };
}

function cleanUploadUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("vk_photo_upload_failed"); }
  if (url.protocol !== "https:") throw new Error("vk_photo_upload_failed");
  return url.toString();
}

async function uploadPhoto({ uploadUrl, bytes, contentType, filename, fieldName = "photo", fetchImpl }) {
  if (!["photo", "file"].includes(fieldName)) throw new Error("vk_photo_upload_failed");
  const form = new FormData();
  form.append(fieldName, new Blob([bytes], { type: contentType }), filename);
  const response = await fetchImpl(uploadUrl, { method: "POST", body: form });
  if (!response.ok) throw new Error("vk_photo_upload_failed");
  const uploaded = await response.json();
  const photo = typeof uploaded?.photo === "string" ? uploaded.photo : JSON.stringify(uploaded?.photo ?? "");
  const hash = String(uploaded?.hash ?? "").trim();
  if (!photo || photo.length > 20000 || !hash || hash.length > 2048) throw new Error("vk_photo_upload_failed");
  return { uploaded, photo, hash };
}

function coverResponseJson(uploaded) {
  if (!uploaded || typeof uploaded !== "object" || Array.isArray(uploaded)) throw new Error("vk_photo_upload_failed");
  const value = JSON.stringify(uploaded);
  if (!value || Buffer.byteLength(value, "utf8") > MAX_COVER_RESPONSE_JSON_BYTES) throw new Error("vk_photo_upload_failed");
  return value;
}

function uploadShape(uploaded) {
  const rawPhoto = uploaded?.photo;
  const photoKind = Array.isArray(rawPhoto) ? "array" : rawPhoto === null ? "null" : typeof rawPhoto;
  const photoString = typeof rawPhoto === "string" ? rawPhoto : "";
  let parsedPhotoKind = null;
  if (photoString) {
    try {
      const parsed = JSON.parse(photoString);
      parsedPhotoKind = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
    } catch {
      parsedPhotoKind = "not_json";
    }
  }
  const objectKeys = rawPhoto && typeof rawPhoto === "object" && !Array.isArray(rawPhoto)
    ? Object.keys(rawPhoto).sort().slice(0, 20)
    : [];
  const firstArrayItemKeys = Array.isArray(rawPhoto) && rawPhoto[0] && typeof rawPhoto[0] === "object"
    ? Object.keys(rawPhoto[0]).sort().slice(0, 20)
    : [];
  return {
    uploadKeys: uploaded && typeof uploaded === "object" ? Object.keys(uploaded).sort().slice(0, 30) : [],
    photoKind,
    photoStringLength: photoString.length,
    photoStartsWithBrace: photoString.startsWith("{"),
    photoStartsWithBracket: photoString.startsWith("["),
    parsedPhotoKind,
    photoObjectKeys: objectKeys,
    firstArrayItemKeys,
    hashKind: typeof uploaded?.hash,
    hashLength: typeof uploaded?.hash === "string" ? uploaded.hash.length : 0,
    serverKind: typeof uploaded?.server,
    serverPresent: uploaded?.server !== undefined && uploaded?.server !== null,
  };
}

function sanitizeImages(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      url: typeof item?.url === "string" ? item.url : "",
      width: Number(item?.width || 0),
      height: Number(item?.height || 0),
    }))
    .filter((item) => /^https:\/\//.test(item.url));
}

async function getCoverUpload({ sourceUrl, groupId, token, apiVersion, fetchImpl }) {
  const { bytes, contentType } = await loadSource(sourceUrl, fetchImpl);
  const server = await vkMethod({
    method: "photos.getOwnerCoverPhotoUploadServer",
    token,
    apiVersion,
    fetchImpl,
    params: {
      group_id: groupId,
      crop_x: String(COVER_CROP.x),
      crop_y: String(COVER_CROP.y),
      crop_x2: String(COVER_CROP.x2),
      crop_y2: String(COVER_CROP.y2),
    },
  });
  const uploadUrl = cleanUploadUrl(server?.upload_url);
  const uploaded = await uploadPhoto({
    uploadUrl,
    bytes,
    contentType,
    filename: contentType === "image/png" ? "cover.png" : "cover.jpg",
    fieldName: "file",
    fetchImpl,
  });
  return uploaded;
}

async function probeGroupCover({ sourceUrl, groupId, token, apiVersion, fetchImpl }) {
  const { uploaded } = await getCoverUpload({ sourceUrl, groupId, token, apiVersion, fetchImpl });
  return { saved: false, upload: uploadShape(uploaded) };
}

async function setGroupCover({ sourceUrl, groupId, token, apiVersion, fetchImpl }) {
  const { uploaded } = await getCoverUpload({ sourceUrl, groupId, token, apiVersion, fetchImpl });
  const saved = await vkMethod({
    method: "photos.saveOwnerCoverPhoto",
    token,
    apiVersion,
    fetchImpl,
    params: { response_json: coverResponseJson(uploaded) },
  });
  const images = sanitizeImages(saved?.images);
  if (!images.length) throw new Error("vk_photo_save_failed");
  return { updated: true, images };
}

async function setGroupAvatar({ sourceUrl, groupId, token, apiVersion, fetchImpl }) {
  const { bytes, contentType } = await loadSource(sourceUrl, fetchImpl);
  const server = await vkMethod({
    method: "photos.getOwnerPhotoUploadServer",
    token,
    apiVersion,
    fetchImpl,
    params: { owner_id: `-${groupId}` },
  });
  const uploadUrl = cleanUploadUrl(server?.upload_url);
  const { uploaded, photo, hash } = await uploadPhoto({
    uploadUrl,
    bytes,
    contentType,
    filename: contentType === "image/png" ? "avatar.png" : "avatar.jpg",
    fetchImpl,
  });
  const uploadServer = String(uploaded?.server ?? "").trim();
  if (!/^-?\d+$/.test(uploadServer)) throw new Error("vk_photo_upload_failed");
  const saved = await vkMethod({
    method: "photos.saveOwnerPhoto",
    token,
    apiVersion,
    fetchImpl,
    params: { server: uploadServer, photo, hash },
  });
  const updated = Number(saved?.saved || 0) === 1 || typeof saved?.photo_src === "string";
  if (!updated) throw new Error("vk_photo_save_failed");
  return {
    updated: true,
    photoUrl: String(saved?.photo_src_big || saved?.photo_src || saved?.photo_src_small || "") || null,
    postId: Number(saved?.post_id || 0) > 0 ? Number(saved.post_id) : null,
  };
}

async function groupBrandingInfo({ groupId, token, apiVersion, fetchImpl }) {
  const result = await vkMethod({
    method: "groups.getById",
    token,
    apiVersion,
    fetchImpl,
    params: { group_ids: groupId, fields: "photo_200,photo_400,photo_max_orig,cover" },
  });
  const groups = Array.isArray(result?.groups) ? result.groups : (Array.isArray(result) ? result : []);
  const group = groups.find((item) => Number(item?.id || 0) === Number(groupId)) || groups[0];
  if (!group) throw new Error("vk_group_not_found");
  return {
    id: Number(group?.id || 0),
    photo200: typeof group?.photo_200 === "string" ? group.photo_200 : null,
    photo400: typeof group?.photo_400 === "string" ? group.photo_400 : null,
    photoMax: typeof group?.photo_max_orig === "string" ? group.photo_max_orig : null,
    cover: group?.cover && typeof group.cover === "object"
      ? { enabled: Number(group.cover.enabled || 0) === 1, images: sanitizeImages(group.cover.images) }
      : null,
  };
}

export async function executeVkGroupBrandingAction(command, { groupId, token, apiVersion, fetchImpl }) {
  if (command.action === "group.cover.set") return setGroupCover({ sourceUrl: command.payload?.sourceUrl, groupId, token, apiVersion, fetchImpl });
  if (command.action === "group.cover.probe" || command.action === "group.cover.userProbe") {
    return probeGroupCover({ sourceUrl: command.payload?.sourceUrl, groupId, token, apiVersion, fetchImpl });
  }
  if (command.action === "group.avatar.set") return setGroupAvatar({ sourceUrl: command.payload?.sourceUrl, groupId, token, apiVersion, fetchImpl });
  if (command.action === "group.branding.info") return groupBrandingInfo({ groupId, token, apiVersion, fetchImpl });
  throw new Error("unsupported_action");
}
