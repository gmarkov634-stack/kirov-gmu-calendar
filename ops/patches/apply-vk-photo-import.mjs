import fs from "node:fs";

const path = "api/src/vk-control.js";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`patch marker not found: ${label}`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  'const MAX_GROUP_WEBSITE_LENGTH = 2048;\nconst COMMUNITY_TOKEN_ACTIONS = new Set(["wall.post", "group.info", "group.edit"]);',
  'const MAX_GROUP_WEBSITE_LENGTH = 2048;\nconst MAX_PHOTO_BYTES = 8 * 1024 * 1024;\nconst PHOTO_SOURCE_HOST = "raw.githubusercontent.com";\nconst PHOTO_SOURCE_PREFIX = "/gmarkov634-stack/kirov-gmu-calendar/";\nconst COMMUNITY_TOKEN_ACTIONS = new Set(["wall.post", "group.info", "group.edit"]);',
  "photo constants",
);

replaceOnce(
  'function bestPhotoUrl(photo) {',
  `function cleanPhotoSourceUrl(value) {\n  const raw = String(value || "").trim();\n  let url;\n  try {\n    url = new URL(raw);\n  } catch {\n    throw new Error("invalid_photo_source_url");\n  }\n  if (url.protocol !== "https:" || url.hostname !== PHOTO_SOURCE_HOST) throw new Error("invalid_photo_source_url");\n  if (!url.pathname.startsWith(PHOTO_SOURCE_PREFIX) || !url.pathname.includes("/ops/vk/assets/")) {\n    throw new Error("invalid_photo_source_url");\n  }\n  if (!/\\.(?:jpe?g|png)$/i.test(url.pathname)) throw new Error("invalid_photo_source_url");\n  if (url.search || url.hash) throw new Error("invalid_photo_source_url");\n  return url.toString();\n}\n\nfunction photoContentType(buffer, declaredType = "") {\n  const type = String(declaredType || "").split(";", 1)[0].trim().toLowerCase();\n  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";\n  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";\n  if (["image/jpeg", "image/png"].includes(type)) return type;\n  throw new Error("invalid_photo_source_content");\n}\n\nasync function importWallPhoto({ sourceUrl, groupId, token, apiVersion, fetchImpl }) {\n  const sourceResponse = await fetchImpl(sourceUrl, {\n    method: "GET",\n    headers: { Accept: "image/jpeg,image/png" },\n    redirect: "error",\n  });\n  if (!sourceResponse.ok) throw new Error("photo_source_unavailable");\n  const bytes = Buffer.from(await sourceResponse.arrayBuffer());\n  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("invalid_photo_source_content");\n  const contentType = photoContentType(bytes, sourceResponse.headers?.get?.("content-type"));\n\n  const uploadServer = await vkMethod({\n    method: "photos.getWallUploadServer",\n    token,\n    apiVersion,\n    fetchImpl,\n    params: { group_id: groupId },\n  });\n  let uploadUrl;\n  try {\n    uploadUrl = new URL(String(uploadServer?.upload_url || ""));\n  } catch {\n    throw new Error("vk_photo_upload_failed");\n  }\n  if (uploadUrl.protocol !== "https:") throw new Error("vk_photo_upload_failed");\n\n  const form = new FormData();\n  form.append("photo", new Blob([bytes], { type: contentType }), contentType === "image/png" ? "post.png" : "post.jpg");\n  const uploadResponse = await fetchImpl(uploadUrl.toString(), { method: "POST", body: form });\n  if (!uploadResponse.ok) throw new Error("vk_photo_upload_failed");\n  const uploaded = await uploadResponse.json();\n  const server = String(uploaded?.server ?? "").trim();\n  const photo = typeof uploaded?.photo === "string" ? uploaded.photo : JSON.stringify(uploaded?.photo ?? "");\n  const hash = String(uploaded?.hash ?? "").trim();\n  if (!/^-?\\d+$/.test(server) || !photo || photo.length > 20000 || !hash || hash.length > 2048) {\n    throw new Error("vk_photo_upload_failed");\n  }\n\n  const saved = await vkMethod({\n    method: "photos.saveWallPhoto",\n    token,\n    apiVersion,\n    fetchImpl,\n    params: { group_id: groupId, server, photo, hash },\n  });\n  const photos = Array.isArray(saved) ? saved : (Array.isArray(saved?.photos) ? saved.photos : []);\n  const item = photos[0];\n  const id = Number(item?.id || 0);\n  const ownerId = Number(item?.owner_id || 0);\n  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(ownerId) || ownerId === 0) throw new Error("vk_photo_save_failed");\n  return {\n    attachment: \`photo\${ownerId}_\${id}\`,\n    photo: { id, ownerId, imageUrl: bestPhotoUrl(item) },\n  };\n}\n\nfunction bestPhotoUrl(photo) {`,
  "photo helpers",
);

replaceOnce(
  '  if (command.action === "wall.post") {',
  `  if (command.action === "photo.importWall") {\n    const sourceUrl = cleanPhotoSourceUrl(command.payload?.sourceUrl);\n    return importWallPhoto({ sourceUrl, groupId, token, apiVersion, fetchImpl });\n  }\n\n  if (command.action === "wall.post") {`,
  "photo action",
);

replaceOnce(
  '        "invalid_group_website",\n        "unsupported_action",',
  '        "invalid_group_website",\n        "invalid_photo_source_url",\n        "invalid_photo_source_content",\n        "unsupported_action",',
  "photo validation errors",
);

replaceOnce(
  '      if (["vk_oauth_vault_not_configured", "vk_oauth_credentials_missing"].includes(error?.message)) {',
  `      if (["photo_source_unavailable", "vk_photo_upload_failed", "vk_photo_save_failed"].includes(error?.message)) {\n        return sendJson(response, 502, { error: error.message });\n      }\n      if (["vk_oauth_vault_not_configured", "vk_oauth_credentials_missing"].includes(error?.message)) {`,
  "photo operational errors",
);

fs.writeFileSync(path, source);
