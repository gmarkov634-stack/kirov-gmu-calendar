import { hasUniversity } from "./universities/registry.mjs";

const UNIVERSITY_ID = /^[a-z][a-z0-9-]{1,31}$/;
const PROGRAM_ID = /^[a-z][a-z0-9_]{1,63}$/;
export const COMMERCIAL_PLAN_IDS = Object.freeze(["semester", "year"]);

function offerError(message, code = "offer_not_configured") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeUniversity(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProgram(value) {
  return String(value || "").trim().toLowerCase();
}

function configuredPlan(config, plan) {
  if (!COMMERCIAL_PLAN_IDS.includes(plan)) {
    throw offerError("Invalid subscription plan", "invalid_plan");
  }
  const source = config?.offers?.[plan];
  const price = String(source?.price || "");
  if (!source || !/^\d+\.\d{2}$/.test(price) || Number(price) <= 0) {
    throw offerError(`Offer is not configured for ${plan}`);
  }
  const expiresAt = source.expiresAt ? String(source.expiresAt) : undefined;
  if (plan === "year" && !Number.isFinite(Date.parse(expiresAt))) {
    throw offerError("Year offer end is not configured");
  }
  return { id: plan, plan, price, expiresAt };
}

export function commercialSku({ university, program, plan }) {
  const normalizedUniversity = normalizeUniversity(university);
  const normalizedProgram = normalizeProgram(program);
  if (
    !UNIVERSITY_ID.test(normalizedUniversity) ||
    !PROGRAM_ID.test(normalizedProgram) ||
    !hasUniversity(normalizedUniversity) ||
    !COMMERCIAL_PLAN_IDS.includes(plan)
  ) {
    return "";
  }
  return `calendar:${normalizedUniversity}:${normalizedProgram}:${plan}`;
}

export function resolveCommercialOffer(config, { university, program, plan = "semester" } = {}) {
  const sku = commercialSku({ university, program, plan });
  if (!sku) {
    if (!COMMERCIAL_PLAN_IDS.includes(plan)) throw offerError("Invalid subscription plan", "invalid_plan");
    throw offerError("Commercial product is not configured for this context");
  }
  const offer = configuredPlan(config, plan);
  if (plan === "year" && Date.now() >= Date.parse(offer.expiresAt)) {
    throw offerError("Year offer has expired", "offer_expired");
  }
  return Object.freeze({ ...offer, sku });
}

export function publicCommercialOffers(config, context = null) {
  const scoped = Boolean(context?.university && context?.program);
  const result = {};
  for (const plan of COMMERCIAL_PLAN_IDS) {
    try {
      const offer = configuredPlan(config, plan);
      if (!scoped) {
        result[plan] = { price: offer.price };
        continue;
      }
      const sku = commercialSku({ ...context, plan });
      if (sku) result[plan] = { price: offer.price, sku };
    } catch {
      // Public metadata is intentionally fail-closed for incomplete offers.
    }
  }
  return result;
}
