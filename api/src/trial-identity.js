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
  const forwarded = boundedHeader(request?.headers?.["x-forwarded-for"]);
  if (forwarded) {
    const hops = forwarded.split(",").map((value) => normalizeAddress(value)).filter(Boolean);
    if (hops.length) return hops.at(-1);
  }
  const realIp = normalizeAddress(boundedHeader(request?.headers?.["x-real-ip"]));
  if (realIp) return realIp;
  return normalizeAddress(request?.socket?.remoteAddress);
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
