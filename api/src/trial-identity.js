import { createHmac } from "node:crypto";

const MAX_HEADER_LENGTH = 1024;
const MIN_SECRET_LENGTH = 32;

function boundedHeader(value) {
  if (Array.isArray(value)) value = value.join(",");
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_HEADER_LENGTH);
}

function normalizeAddress(value) {
  let address = String(value || "").trim();
  if (!address) return "";
  if (address.startsWith("::ffff:")) address = address.slice(7);
  if (address === "::1") return "::1";
  return address.slice(0, 128);
}

function requestAddress(request) {
  // Prefer an explicit real-IP header produced by a trusted ingress. Do not
  // guess which hop is the client in a multi-hop X-Forwarded-For chain: proxy
  // append/prepend semantics vary, and a wrong guess can collapse many users
  // to one identity or make the identity spoofable. Until the production
  // Container Apps header contract is verified, ambiguous chains fail closed.
  const realIp = normalizeAddress(boundedHeader(request?.headers?.["x-real-ip"]));
  if (realIp) return realIp;

  const forwarded = boundedHeader(request?.headers?.["x-forwarded-for"]);
  if (!forwarded) return "";
  const hops = forwarded.split(",").map((value) => normalizeAddress(value)).filter(Boolean);
  return hops.length === 1 ? hops[0] : "";
}

export function trialIdentityFingerprint(request, secret) {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) return null;
  const address = requestAddress(request);
  if (!address) return null;
  const userAgent = boundedHeader(request?.headers?.["user-agent"]);
  const acceptLanguage = boundedHeader(request?.headers?.["accept-language"]);
  const canonical = [
    "ugmu-trial-identity:v1",
    address,
    userAgent,
    acceptLanguage,
  ].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export { requestAddress as trialRequestAddress };
