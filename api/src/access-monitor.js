import { createHmac } from "node:crypto";

function networkPrefix(value) {
  const ip = String(value || "").split(",", 1)[0].trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").slice(0, 3).join(".");
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":");
  return "unknown";
}

function clientFamily(userAgent) {
  const value = String(userAgent || "").toLowerCase();
  if (value.includes("google") || value.includes("gcalendar")) return "google";
  if (value.includes("apple") || value.includes("calendaragent") || value.includes("dataaccessd")) return "apple";
  if (value.includes("outlook") || value.includes("microsoft")) return "outlook";
  return "other";
}

export function accessObservation(request, secret, now = new Date()) {
  const forwarded = request.headers["x-forwarded-for"] || request.socket?.remoteAddress;
  const userAgent = request.headers["user-agent"] || "";
  const client = clientFamily(userAgent);
  const input = `${networkPrefix(forwarded)}\n${client}\n${String(userAgent).slice(0, 256)}`;
  return {
    fingerprint: createHmac("sha256", secret).update(input).digest("hex"),
    client,
    seenAt: now.toISOString(),
  };
}
