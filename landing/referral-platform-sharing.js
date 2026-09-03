import {
  buildPublicReferralUrl,
  buildShareText,
  createReferralId,
  normalizePublicContext
} from "./referral-sharing.js";

const PUBLIC_CONTEXT_KEY = "kgmu-calendar:public-group-context-v1";
const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicHttpUrl(value, label) {
  let parsed;
  try {
    parsed = value instanceof URL ? new URL(value.toString()) : new URL(String(value));
  } catch {
    throw new TypeError(`${label} must be a valid URL`);
  }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError(`${label} must use http or https without credentials`);
  }
  return parsed.toString();
}

export function buildMaxShareUrl(shareUrl, text) {
  const target = new URL("https://max.ru/:share");
  target.searchParams.set("text", `${String(text).trim()}\n${publicHttpUrl(shareUrl, "shareUrl")}`);
  return target.toString();
}

export function buildVkShareUrl(shareUrl, title) {
  const target = new URL("https://vk.com/share.php");
  target.searchParams.set("url", publicHttpUrl(shareUrl, "shareUrl"));
  target.searchParams.set("title", String(title).trim());
  return target.toString();
}

function readContext() {
  try {
    const raw = sessionStorage.getItem(PUBLIC_CONTEXT_KEY);
    return raw ? normalizePublicContext(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function publicLandingUrl() {
  const current = new URL(window.location.href);
  const isManage = /\/manage\/?$/.test(current.pathname);
  const landing = isManage ? new URL("../", current) : new URL(current.pathname, current.origin);
  landing.search = "";
  landing.hash = "";
  return landing.toString();
}

function createEventId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== "function") return null;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function platformName() {
  const ua = String(navigator.userAgent ?? "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "web";
}

function trackShare(context, source, referralId, action) {
  const config = Object.freeze({
    apiBase: "",
    universityId: "kirov-gmu",
    academicYearId: "2026-2027",
    referralAnalyticsEnabled: false,
    ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
  });
  if (config.referralAnalyticsEnabled !== true) return;
  const eventId = createEventId();
  if (!eventId || !EVENT_ID_RE.test(eventId)) return;
  const endpoint = new URL("/acquisition/events", config.apiBase || window.location.origin).toString();
  const body = {
    eventId,
    eventType: "share_click",
    universityId: config.universityId,
    facultyId: context.faculty,
    course: context.course,
    groupId: context.group,
    academicYearId: config.academicYearId,
    source,
    referralId,
    platform: platformName(),
    action
  };
  void globalThis.fetch(endpoint, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => null);
}

function shareAnchor(label, href, platform, context, source, referralId) {
  const anchor = document.createElement("a");
  anchor.className = "pay-button button button-primary referral-platform-action";
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.dataset.referralPlatform = platform;
  anchor.textContent = label;
  anchor.addEventListener("click", () => trackShare(context, source, referralId, platform));
  return anchor;
}

function decorateShareCard(card) {
  if (card.dataset.platformShareReady === "true") return;
  const context = readContext();
  if (!context) return;

  const text = buildShareText(context);
  const base = publicLandingUrl();
  const maxReferralId = createReferralId();
  const vkReferralId = createReferralId();
  const maxPublicUrl = buildPublicReferralUrl(base, context, {
    source: "max-share",
    referralId: maxReferralId
  });
  const vkPublicUrl = buildPublicReferralUrl(base, context, {
    source: "vk-share",
    referralId: vkReferralId
  });

  const actions = card.querySelector(".referral-share-actions");
  if (!actions) return;
  const generic = [...actions.querySelectorAll("button")]
    .find((button) => /Отправить в чат группы/i.test(button.textContent ?? ""));
  if (generic) generic.hidden = true;

  const max = shareAnchor(
    "Отправить в MAX",
    buildMaxShareUrl(maxPublicUrl, text),
    "max",
    context,
    "max-share",
    maxReferralId
  );
  const vk = shareAnchor(
    "Отправить ВКонтакте",
    buildVkShareUrl(vkPublicUrl, `Расписание группы ${context.group} — КГМУ`),
    "vk",
    context,
    "vk-share",
    vkReferralId
  );
  actions.prepend(max, vk);
  card.dataset.platformShareReady = "true";
}

function apply() {
  document.querySelectorAll("[data-referral-share-card]").forEach(decorateShareCard);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const root = document.querySelector("main") ?? document.body;
  const observer = new MutationObserver(apply);
  observer.observe(root, { childList: true, subtree: true });
  apply();
}
