import { createHash, randomBytes } from "node:crypto";
import { normalizeAcademicYear, scheduleContext } from "./order-context.js";
import { semesterEndFromSchedule } from "./subscription-period.js";
import { trialWindowFromSchedule } from "./trial-projection.js";
import { runtimeTrialContextAllowed, trialServiceEnabled } from "./trial-access-policy.mjs";

const SHA256 = /^[a-f0-9]{64}$/;

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function trialIdentityClaimHash(context, identityHash) {
  const academicYear = normalizeAcademicYear(context.academicYear);
  if (!academicYear || ![1, 2].includes(Number(context.semester)) || !SHA256.test(String(identityHash || ""))) return "";
  return tokenHash([
    "trial-identity-claim:v1",
    context.university,
    academicYear,
    Number(context.semester),
    identityHash,
  ].join("\n"));
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

  async create(input = {}, requestMeta = {}) {
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
    const now = this.now();
    const windowState = trialWindowFromSchedule(schedule, { activationAt: now, timezone: actual.timezone });
    if (!windowState) throw fail("trial_not_ready");
    if (windowState.trialWindowClosed) throw fail("trial_window_closed");
    if (!Number.isInteger(windowState.scheduleEventCount) || windowState.scheduleEventCount < 1) {
      throw fail("trial_schedule_unavailable");
    }
    const window = {
      trialStartDate: windowState.trialStartDate,
      trialEndDateExclusive: windowState.trialEndDateExclusive,
    };

    const token = randomId();
    const conversionId = randomId();
    const createdAt = now.toISOString();
    const expiresAt = semesterEndFromSchedule(schedule);
    const attribution = safeAttribution(input);

    // UGMU anonymous trials are limited to one claim per privacy-preserving
    // request identity for the whole semester, not one claim per group. The
    // raw address/user-agent never reaches storage; only a scoped SHA-256 key
    // derived from the handler's HMAC fingerprint is persisted as an object key.
    if (actual.university === "ugmu") {
      if (typeof this.store?.claimTrialIdentityByHash !== "function") throw fail("trial_not_ready", "trial identity claim storage is unavailable");
      const identityClaimHash = trialIdentityClaimHash(actual, requestMeta.identityHash);
      if (!identityClaimHash) throw fail("trial_not_ready", "trial identity is unavailable");
      const claimed = await this.store.claimTrialIdentityByHash(identityClaimHash, {
        version: 1,
        policy: "one-anonymous-trial-per-university-semester",
        university: actual.university,
        academicYear: normalizeAcademicYear(actual.academicYear),
        semester: Number(actual.semester),
        conversionIdHash: tokenHash(conversionId),
        createdAt,
      });
      if (!claimed) throw fail("trial_already_claimed");
    }

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
    // subscription entitlement exists. For UGMU the identity claim deliberately
    // remains fail-closed if a later write fails; automatic claim release would
    // re-open a race that permits duplicate anonymous trials.
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

export { safeAttribution, trialIdentityClaimHash, tokenHash as trialTokenHash };