const REFERRAL_FACULTIES = Object.freeze({
  medicine: Object.freeze({ full: "Лечебный факультет", short: "Лечебное дело" }),
  pediatrics: Object.freeze({ full: "Педиатрический факультет", short: "Педиатрия" }),
  dentistry: Object.freeze({ full: "Стоматологический факультет", short: "Стоматология" })
});

const PUBLIC_CONTEXT_KEY = "kgmu-calendar:public-group-context-v1";
const SHARE_SOURCE = "success-share";
const SOURCE_RE = /^[a-z][a-z0-9-]{0,31}$/;
const REFERRAL_ID_RE = /^[A-Za-z0-9_-]{6,32}$/;
const GROUP_ID_RE = /^[1-9][0-9]{2}$/;
const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set([
  "group_view",
  "acquisition_choice",
  "trial_started",
  "checkout_started",
  "subscription_ready",
  "share_prompt_view",
  "share_click",
  "referral_visit",
  "referral_activation",
  "referral_purchase"
]);

function parseUrl(value) {
  try {
    return value instanceof URL ? new URL(value.toString()) : new URL(String(value));
  } catch {
    return null;
  }
}

function normalizeCourse(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 6 ? parsed : null;
}

function normalizeGroupId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return GROUP_ID_RE.test(text) ? text : null;
}

function normalizeSource(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return SOURCE_RE.test(text) ? text : null;
}

function normalizeReferralId(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  return REFERRAL_ID_RE.test(text) ? text : null;
}

export function normalizePublicContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const faculty = typeof value.faculty === "string" ? value.faculty : "";
  if (!Object.hasOwn(REFERRAL_FACULTIES, faculty)) return null;
  const course = normalizeCourse(value.course);
  const group = normalizeGroupId(value.group);
  if (!course || !group) return null;
  const source = normalizeSource(value.source);
  const rid = normalizeReferralId(value.rid);
  if ((value.source != null && value.source !== "" && !source) || (value.rid != null && value.rid !== "" && !rid)) {
    return null;
  }
  return Object.freeze({ faculty, course, group, source, rid });
}

export function parseReferralContext(urlLike) {
  const url = parseUrl(urlLike);
  if (!url) return null;
  const faculty = url.searchParams.get("faculty");
  const course = url.searchParams.get("course");
  const group = url.searchParams.get("group");
  if (faculty == null && course == null && group == null) return null;
  if (faculty == null || course == null || group == null) return null;
  return normalizePublicContext({
    faculty,
    course,
    group,
    source: url.searchParams.get("src"),
    rid: url.searchParams.get("rid")
  });
}

export function buildPublicReferralUrl(baseUrl, context, {
  source = SHARE_SOURCE,
  referralId
} = {}) {
  const normalized = normalizePublicContext(context);
  const normalizedSource = normalizeSource(source);
  const normalizedReferralId = normalizeReferralId(referralId);
  if (!normalized) throw new TypeError("valid public group context is required");
  if (!normalizedSource) throw new TypeError("valid referral source is required");
  if (!normalizedReferralId) throw new TypeError("valid referral id is required");
  const url = parseUrl(baseUrl);
  if (!url || !["https:", "http:"].includes(url.protocol)) {
    throw new TypeError("public landing URL must use http or https");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.searchParams.set("faculty", normalized.faculty);
  url.searchParams.set("course", String(normalized.course));
  url.searchParams.set("group", normalized.group);
  url.searchParams.set("src", normalizedSource);
  url.searchParams.set("rid", normalizedReferralId);
  return url.toString();
}

export function buildShareText(context) {
  const normalized = normalizePublicContext(context);
  if (!normalized) throw new TypeError("valid public group context is required");
  return `Я себе подключил расписание группы ${normalized.group} в календарь. Тут сразу пары, аудитории и напоминания, а изменения обновляются автоматически.`;
}

export function createReferralId(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.getRandomValues !== "function") {
    throw new Error("secure random generator is unavailable");
  }
  const bytes = new Uint8Array(9);
  cryptoObject.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
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

function safeSessionRead() {
  try {
    const raw = sessionStorage.getItem(PUBLIC_CONTEXT_KEY);
    if (!raw) return null;
    return normalizePublicContext(JSON.parse(raw));
  } catch {
    return null;
  }
}

function safeSessionWrite(context) {
  const normalized = normalizePublicContext(context);
  if (!normalized) return false;
  try {
    sessionStorage.setItem(PUBLIC_CONTEXT_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

function facultyFromTitle(text) {
  for (const [faculty, meta] of Object.entries(REFERRAL_FACULTIES)) {
    if (text.includes(meta.full) || text.includes(meta.short)) return faculty;
  }
  return null;
}

function selectionFromDom() {
  const title = document.querySelector("#selector-title")?.textContent ?? "";
  const faculty = facultyFromTitle(title);
  const course = /(?:^|·)\s*(\d)\s*курс/i.exec(title)?.[1] ?? null;
  const group = /группа\s+(\d{3})/i.exec(title)?.[1]
    ?? /группа\s+(\d{3})/i.exec(document.querySelector(".group-preview-head h3")?.textContent ?? "")?.[1]
    ?? /группа\s+(\d{3})/i.exec(document.querySelector(".trial-connect-card h3")?.textContent ?? "")?.[1]
    ?? null;
  if (!faculty || !course || !group) return null;
  const previous = safeSessionRead();
  return normalizePublicContext({
    faculty,
    course,
    group,
    source: previous?.source ?? null,
    rid: previous?.rid ?? null
  });
}

function publicLandingUrl() {
  const current = new URL(window.location.href);
  const isManage = /\/manage\/?$/.test(current.pathname);
  const landing = isManage ? new URL("../", current) : new URL(current.pathname, current.origin);
  landing.search = "";
  landing.hash = "";
  return landing.toString();
}

function platformName() {
  const ua = String(navigator.userAgent ?? "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "web";
}

function analyticsConfig() {
  return Object.freeze({
    apiBase: "",
    universityId: "kirov-gmu",
    academicYearId: "2026-2027",
    referralAnalyticsEnabled: false,
    ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
  });
}

function trackEvent(eventType, context, extra = {}) {
  const config = analyticsConfig();
  const normalized = normalizePublicContext(context);
  if (config.referralAnalyticsEnabled !== true || !EVENT_TYPES.has(eventType) || !normalized) return;
  const eventId = createEventId();
  if (!eventId || !EVENT_ID_RE.test(eventId)) return;
  const endpoint = new URL("/acquisition/events", config.apiBase || window.location.origin).toString();
  const body = {
    eventId,
    eventType,
    universityId: config.universityId,
    facultyId: normalized.faculty,
    course: normalized.course,
    groupId: normalized.group,
    academicYearId: config.academicYearId,
    source: normalized.source,
    referralId: normalized.rid,
    platform: platformName(),
    action: typeof extra.action === "string" ? extra.action : null
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

function captureSelection() {
  const current = selectionFromDom();
  if (!current) return null;
  const existing = safeSessionRead();
  const next = normalizePublicContext({
    ...current,
    source: existing?.source ?? current.source,
    rid: existing?.rid ?? current.rid
  });
  if (next) safeSessionWrite(next);
  return next;
}

function clearReferralQuery() {
  try {
    const url = new URL(window.location.href);
    for (const name of ["faculty", "course", "group", "src", "rid"]) url.searchParams.delete(name);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
  }
}

function sameGroup(left, right) {
  return Boolean(left && right
    && left.faculty === right.faculty
    && left.course === right.course
    && left.group === right.group);
}

function installStyles() {
  if (document.querySelector("style[data-referral-sharing-style]")) return;
  const style = document.createElement("style");
  style.dataset.referralSharingStyle = "true";
  style.textContent = `
    .referral-arrival-note,.referral-share-card{border:1px solid rgba(33,78,121,.18);border-radius:18px;background:#f7fbff;padding:16px;margin:16px 0;display:grid;gap:10px}
    .referral-arrival-note strong,.referral-share-card strong{font-size:1rem}
    .referral-arrival-note p,.referral-share-card p{margin:0;color:var(--muted,#5f6b76);line-height:1.45}
    .referral-share-actions{display:flex;flex-wrap:wrap;gap:10px}
    .referral-share-actions button{min-height:44px}
  `;
  document.head.append(style);
}

function ensureArrivalNote(context, preselectionState) {
  const preview = document.querySelector(".group-preview");
  if (!preview || preview.querySelector("[data-referral-arrival-note]")) return;
  const note = document.createElement("div");
  note.className = "referral-arrival-note";
  note.dataset.referralArrivalNote = "true";
  const title = document.createElement("strong");
  title.textContent = `Расписание группы ${context.group} уже выбрано`;
  const copy = document.createElement("p");
  copy.textContent = `${REFERRAL_FACULTIES[context.faculty].short} · ${context.course} курс. Можно сразу посмотреть расписание и выбрать бесплатную пробу или полный доступ.`;
  const change = document.createElement("button");
  change.type = "button";
  change.className = "secondary-action";
  change.textContent = "Не ваша группа? Изменить";
  change.addEventListener("click", () => {
    preselectionState.disabled = true;
    clearReferralQuery();
    const existing = preview.querySelector(".preview-actions .secondary-action");
    existing?.click();
  });
  note.append(title, copy, change);
  preview.insertBefore(note, preview.children[1] ?? null);
}

function createShareCard(context, { purchase = false } = {}) {
  const normalized = normalizePublicContext(context);
  if (!normalized) return null;
  const referralId = createReferralId();
  const shareUrl = buildPublicReferralUrl(publicLandingUrl(), normalized, {
    source: SHARE_SOURCE,
    referralId
  });
  const card = document.createElement("section");
  card.className = "referral-share-card";
  card.dataset.referralShareCard = "true";
  const title = document.createElement("strong");
  title.textContent = "Отправьте календарь в чат группы";
  const copy = document.createElement("p");
  copy.textContent = "У одногруппников то же расписание. По ссылке факультет, курс и группа уже выбраны. Персональная ICS-ссылка не передаётся.";
  const actions = document.createElement("div");
  actions.className = "referral-share-actions";
  const share = document.createElement("button");
  share.type = "button";
  share.className = "pay-button button button-primary";
  share.textContent = "Отправить в чат группы";
  share.addEventListener("click", async () => {
    trackEvent("share_click", normalized, { action: purchase ? "paid" : "trial" });
    const text = buildShareText(normalized);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `Расписание группы ${normalized.group}`, text, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
      share.textContent = "Ссылка скопирована";
      setTimeout(() => { share.textContent = "Отправить в чат группы"; }, 1800);
    } catch (error) {
      if (error?.name === "AbortError") return;
      share.textContent = "Не удалось поделиться";
      setTimeout(() => { share.textContent = "Отправить в чат группы"; }, 1800);
    }
  });
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "secondary-action button button-secondary";
  copyButton.textContent = "Скопировать ссылку";
  copyButton.addEventListener("click", async () => {
    trackEvent("share_click", normalized, { action: purchase ? "paid-copy" : "trial-copy" });
    try {
      await navigator.clipboard.writeText(shareUrl);
      copyButton.textContent = "Скопировано";
      setTimeout(() => { copyButton.textContent = "Скопировать ссылку"; }, 1800);
    } catch {
      copyButton.textContent = "Не удалось скопировать";
    }
  });
  actions.append(share, copyButton);
  card.append(title, copy, actions);
  trackEvent("share_prompt_view", normalized, { action: purchase ? "paid" : "trial" });
  return card;
}

function markReady(context, { purchase = false } = {}) {
  const normalized = normalizePublicContext(context);
  if (!normalized) return;
  trackEvent("subscription_ready", normalized, { action: purchase ? "paid" : "trial" });
  if (normalized.rid) {
    trackEvent(purchase ? "referral_purchase" : "referral_activation", normalized, {
      action: purchase ? "paid" : "trial"
    });
  }
}

function ensureTrialShareCard() {
  const card = document.querySelector(".trial-connect-card");
  if (!card || card.querySelector("[data-referral-share-card]")) return;
  const heading = card.querySelector("h3")?.textContent ?? "";
  if (!/Пробный календарь создан/i.test(heading) || !card.querySelector("#copy-trial-url")) return;
  const context = captureSelection() ?? safeSessionRead();
  if (!context) return;
  const shareCard = createShareCard(context, { purchase: false });
  if (!shareCard) return;
  card.append(shareCard);
  if (card.dataset.referralReadyTracked !== "true") {
    card.dataset.referralReadyTracked = "true";
    markReady(context, { purchase: false });
  }
}

function ensurePaidShareCard() {
  if (!/\/manage\/?$/.test(window.location.pathname)) return;
  const status = document.querySelector("#management-status")?.textContent ?? "";
  if (!/Оплата подтверждена/i.test(status)) return;
  const context = safeSessionRead();
  if (!context) return;
  const cards = [...document.querySelectorAll("#subscription-list .subscription-item")];
  const target = cards.find((card) => new RegExp(`группа\\s+${context.group}(?:\\D|$)`, "i").test(card.querySelector("h3")?.textContent ?? ""));
  if (!target || target.querySelector("[data-referral-share-card]")) return;
  const shareCard = createShareCard(context, { purchase: true });
  if (!shareCard) return;
  const initialLink = target.querySelector("[data-initial-calendar-link]");
  if (initialLink) initialLink.insertAdjacentElement("afterend", shareCard);
  else target.append(shareCard);
  if (target.dataset.referralReadyTracked !== "true") {
    target.dataset.referralReadyTracked = "true";
    markReady(context, { purchase: true });
  }
}

function wireAcquisitionEvents() {
  const preview = document.querySelector(".group-preview");
  const context = preview ? captureSelection() : safeSessionRead();
  if (preview && context && preview.dataset.referralGroupViewTracked !== "true") {
    preview.dataset.referralGroupViewTracked = "true";
    trackEvent("group_view", context);
  }

  if (preview && context) {
    for (const button of preview.querySelectorAll(".preview-actions .pay-button")) {
      if (button.dataset.referralChoiceTracked === "true") continue;
      button.dataset.referralChoiceTracked = "true";
      const action = /7 дней/i.test(button.textContent ?? "") ? "trial" : "purchase";
      button.addEventListener("click", () => trackEvent("acquisition_choice", context, { action }));
    }
  }

  const trialForm = document.querySelector("#runtime-trial-form");
  if (trialForm && trialForm.dataset.referralSubmitTracked !== "true") {
    trialForm.dataset.referralSubmitTracked = "true";
    trialForm.addEventListener("submit", () => {
      const current = safeSessionRead();
      if (current) trackEvent("trial_started", current, { action: "trial" });
    });
  }

  const checkoutForm = document.querySelector("#runtime-checkout-form");
  if (checkoutForm && checkoutForm.dataset.referralSubmitTracked !== "true") {
    checkoutForm.dataset.referralSubmitTracked = "true";
    checkoutForm.addEventListener("submit", () => {
      const current = safeSessionRead();
      if (current) trackEvent("checkout_started", current, { action: "purchase" });
    });
  }
}

function bootReferralSharing() {
  installStyles();
  const incoming = parseReferralContext(window.location.href);
  const paymentReturn = new URLSearchParams(window.location.search).get("payment") === "return";
  const preselectionState = { disabled: paymentReturn || !incoming, completed: false };

  if (incoming) {
    safeSessionWrite(incoming);
    trackEvent("referral_visit", incoming);
  }

  function drivePreselection() {
    if (preselectionState.disabled || preselectionState.completed || !incoming) return;
    const current = selectionFromDom();
    if (sameGroup(current, incoming) && document.querySelector(".group-preview")) {
      preselectionState.completed = true;
      const merged = normalizePublicContext({ ...incoming });
      if (merged) {
        safeSessionWrite(merged);
        ensureArrivalNote(merged, preselectionState);
      }
      return;
    }

    const cards = [...document.querySelectorAll("#choice-grid .choice-card")];
    const groupCard = cards.find((card) => (card.querySelector("strong")?.textContent ?? "").trim() === `Группа ${incoming.group}`);
    if (groupCard) {
      groupCard.click();
      return;
    }
    const courseCard = cards.find((card) => (card.querySelector("strong")?.textContent ?? "").trim() === `${incoming.course} курс`);
    if (courseCard) {
      courseCard.click();
      return;
    }
    const facultyTitle = REFERRAL_FACULTIES[incoming.faculty].full;
    const facultyCard = cards.find((card) => (card.querySelector("strong")?.textContent ?? "").trim() === facultyTitle);
    facultyCard?.click();
  }

  function apply() {
    drivePreselection();
    if (incoming && preselectionState.completed) ensureArrivalNote(incoming, preselectionState);
    wireAcquisitionEvents();
    ensureTrialShareCard();
    ensurePaidShareCard();
  }

  const root = document.querySelector("main") ?? document.body;
  const observer = new MutationObserver(apply);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  apply();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bootReferralSharing, { once: true });
  } else {
    bootReferralSharing();
  }
}
