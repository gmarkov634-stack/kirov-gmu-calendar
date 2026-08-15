const VK_WALL_GET_URL = "https://api.vk.com/method/wall.get";
const DEFAULT_API_VERSION = "5.199";
const WALL_POST_LIMIT = 20;

function sendJson(response, status, body, cacheControl = "no-store") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
  });
  response.end(JSON.stringify(body));
}

function bestPhotoUrl(photo) {
  const sizes = Array.isArray(photo?.sizes) ? photo.sizes : [];
  const best = [...sizes]
    .filter((size) => typeof size?.url === "string" && size.url)
    .sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0))[0];
  return best?.url || null;
}

function sanitizeAttachment(attachment) {
  const type = typeof attachment?.type === "string" ? attachment.type : "unknown";
  if (type === "photo") {
    return {
      type,
      id: attachment.photo?.id ?? null,
      ownerId: attachment.photo?.owner_id ?? null,
      text: String(attachment.photo?.text || ""),
      imageUrl: bestPhotoUrl(attachment.photo),
    };
  }
  if (type === "video") {
    const images = Array.isArray(attachment.video?.image) ? attachment.video.image : [];
    const preview = [...images]
      .filter((image) => typeof image?.url === "string" && image.url)
      .sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0))[0];
    return {
      type,
      id: attachment.video?.id ?? null,
      ownerId: attachment.video?.owner_id ?? null,
      title: String(attachment.video?.title || ""),
      duration: Number(attachment.video?.duration || 0),
      previewUrl: preview?.url || null,
    };
  }
  if (type === "link") {
    return {
      type,
      title: String(attachment.link?.title || ""),
      caption: String(attachment.link?.caption || ""),
      description: String(attachment.link?.description || ""),
      url: typeof attachment.link?.url === "string" ? attachment.link.url : null,
      imageUrl: bestPhotoUrl(attachment.link?.photo),
    };
  }
  if (type === "doc") {
    return {
      type,
      id: attachment.doc?.id ?? null,
      ownerId: attachment.doc?.owner_id ?? null,
      title: String(attachment.doc?.title || ""),
      ext: String(attachment.doc?.ext || ""),
      size: Number(attachment.doc?.size || 0),
    };
  }
  if (type === "poll") {
    return {
      type,
      id: attachment.poll?.id ?? null,
      ownerId: attachment.poll?.owner_id ?? null,
      question: String(attachment.poll?.question || ""),
    };
  }
  return { type };
}

function sanitizePost(post) {
  const timestamp = Number(post?.date || 0);
  return {
    id: Number(post?.id || 0),
    ownerId: Number(post?.owner_id || 0),
    fromId: Number(post?.from_id || 0),
    date: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null,
    text: String(post?.text || ""),
    postType: String(post?.post_type || "post"),
    isPinned: Number(post?.is_pinned || 0) === 1,
    markedAsAds: Number(post?.marked_as_ads || 0) === 1,
    comments: Number(post?.comments?.count || 0),
    likes: Number(post?.likes?.count || 0),
    reposts: Number(post?.reposts?.count || 0),
    views: Number(post?.views?.count || 0),
    attachments: Array.isArray(post?.attachments) ? post.attachments.map(sanitizeAttachment) : [],
  };
}

export function createVkWallHandler(env = process.env, dependencies = {}) {
  const groupId = String(env.VK_CALLBACK_GROUP_ID || "").trim();
  const accessToken = String(env.VK_USER_ACCESS_TOKEN || "").trim();
  const apiVersion = String(env.VK_API_VERSION || DEFAULT_API_VERSION).trim();
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;

  return async function handleVkWall(request, response) {
    if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
    if (!groupId || !/^\d+$/.test(groupId) || !accessToken) {
      return sendJson(response, 503, { error: "vk_wall_not_configured" });
    }

    try {
      const body = new URLSearchParams({
        access_token: accessToken,
        v: apiVersion,
        owner_id: `-${groupId}`,
        count: String(WALL_POST_LIMIT),
        filter: "owner",
        extended: "0",
      });
      const vkResponse = await fetchImpl(VK_WALL_GET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!vkResponse.ok) throw new Error(`vk_http_${vkResponse.status}`);
      const result = await vkResponse.json();
      if (result?.error) throw new Error(`vk_api_${result.error.error_code || "error"}`);

      const items = Array.isArray(result?.response?.items) ? result.response.items : [];
      return sendJson(response, 200, {
        groupId: Number(groupId),
        fetchedAt: new Date().toISOString(),
        total: Number(result?.response?.count || items.length),
        count: items.length,
        posts: items.map(sanitizePost),
      }, "public, max-age=60");
    } catch (error) {
      console.error("vk wall read failed", error);
      return sendJson(response, 502, { error: "vk_wall_unavailable" });
    }
  };
}
