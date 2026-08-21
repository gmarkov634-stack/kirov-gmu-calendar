import { createHash, randomBytes } from "node:crypto";
import { normalizeAcademicYear, scheduleContext } from "./order-context.js";
import { semesterEndFromSchedule } from "./subscription-period.js";
import { trialWindowFromSchedule } from "./trial-projection.js";
import { runtimeTrialContextAllowed, trialServiceEnabled } from "./trial-access-policy.mjs";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function randomId() {
  return randomBytes(32).toString("base64url");
}

function safeAttribution(input = {}) {
  const result = {};
  for (const key of ["source", "medium", "campaign", "content", "referral"]) {
    const value = input[key];
    result[key] = typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : null;
  }
  return result;
}

function localDate(now, timezone) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError("invalid current time");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizedHttpsBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function continueUrl(config, university, conversionId) {
  const base = normalizedHttpsBaseUrl(config.universitySiteUrls?.[university]);
  if (!base) throw fail("trial_not_ready", "university site URL is not configured");
  const url = new URL(`${base}/`);
  url.searchParams.set("continue", conversionId);
  return url.toString();
}

function subscriptionUrl(config, token) {
  const base = normalizedHttpsBaseUrl(config.publicApiUrl);
  if (!base) throw fail("trial_not_ready", "public API URL is not configured");
  return `${base}/api/v1/subscriptions/${token}/calendar.ics`;
}

function requestContext(input, config) {
  const context = scheduleContext({
    ...input,
    academicYear: config.offerAcademicYear,
    semester: Number(config.offerSemester),
  }, input?.university);
  if (
    !context.university ||
    !context.program ||
    !Number.isInteger(context.course) ||
    context.course < 1 ||
    !context.groupCode ||
    !context.groupId
  ) throw fail("invalid_trial_context");
  return context;
}

function assertOfferSchedule(schedule, requested, config) {
  if (!schedule) throw fail("offer_not_found");
  const actual = scheduleContext(schedule);
  const expectedYear = normalizeAcademicYear(config.offerAcademicYear);
  const actualYear = normalizeAcademicYear(actual.academicYear);
  const expectedSemester = Number(config.offerSemester);
  if (
    actual.university !== requested.university ||
    actual.program !== requested.program ||
    actual.course !== requested.course ||
    actual.groupId !== requested.groupId ||
    !expectedYear ||
    actualYear !== expectedYear ||
    actual.semester !== expectedSemester
  ) throw fail("offer_not_found");
  return actual;
}

export class TrialService {
  constructor({ store, config, now = () => new Date() }) {
    this.store = store;
    this.config = config;
    this.now = now;
  }

  get enabled() {
    return trialServiceEnabled(this.config);
  }

  async create(input = {}) {
    if (!this.enabled) throw fail("trials_not_open");
    if (typeof this.store?.putTrialConversion !== "function") throw fail("trial_not_ready", "trial conversion storage is unavailable");

    const requested = requestContext(input, this.config);
    if (!runtimeTrialContextAllowed(this.config, requested)) throw fail("university_trials_not_open");
    const schedule = await this.store.getSchedule({
      ...requested,
      academicYear: this.config.offerAcademicYear,
      semester: Number(this.config.offerSemester),
      plan: "semester",
    });
    const actual = assertOfferSchedule(schedule, requested, this.config);
    const window = trialWindowFromSchedule(schedule);
    if (!window) throw fail("trial_not_ready");
    if (localDate(this.now(), actual.timezone) >= window.trialEndDateExclusive) throw fail("trial_window_closed");

    const token = randomId();
    const conversionId = randomId();
    const createdAt = this.now().toISOString();
    const expiresAt = semesterEndFromSchedule(schedule);
    const attribution = safeAttribution(input);
    const record = {
      version: 2,
      status: "active",
      entitlement: "trial",
      ...actual,
      plan: "semester",
      ...window,
      conversionId,
      expiresAt,
      createdAt,
    };
    const conversion = {
      version: 1,
      conversionIdHash: tokenHash(conversionId),
      trialTokenHash: tokenHash(token),
      status: "active",
      ...actual,
      ...window,
      attribution,
      createdAt,
    };

    // Store the non-privileged conversion context first. If it fails, no live
    // subscription entitlement exists. An orphaned conversion context is safe;
    // an orphaned live trial URL is not.
    await this.store.putTrialConversion(conversionId, conversion);
    await this.store.putSubscription(token, record);

    return {
      status: "active",
      groupCode: actual.groupCode,
      ...window,
      subscriptionUrl: subscriptionUrl(this.config, token),
      conversionId,
      continueUrl: continueUrl(this.config, actual.university, conversionId),
    };
  }

  async continue(conversionId) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(conversionId || ""))) return null;
    if (typeof this.store?.getTrialConversion !== "function") return null;
    const value = await this.store.getTrialConversion(conversionId);
    if (!value || value.status !== "active") return null;
    const {
      conversionIdHash: _conversionIdHash,
      trialTokenHash: _trialTokenHash,
      ...safe
    } = value;
    return safe;
  }
}

export { safeAttribution, tokenHash as trialTokenHash };