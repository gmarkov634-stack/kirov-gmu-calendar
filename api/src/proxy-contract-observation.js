function boundedHeader(value) {
  if (Array.isArray(value)) value = value.join(",");
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 1024);
}

function normalizeAddress(value) {
  let address = String(value || "").trim();
  if (!address) return "";
  if (address.startsWith("::ffff:")) address = address.slice(7);
  return address.slice(0, 128);
}

function sameAddress(left, right) {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  return Boolean(a && b && a === b);
}

export function proxyContractObservation(request) {
  const xRealIp = normalizeAddress(boundedHeader(request?.headers?.["x-real-ip"]));
  const xForwardedFor = boundedHeader(request?.headers?.["x-forwarded-for"]);
  const xffHops = xForwardedFor
    ? xForwardedFor.split(",").map((value) => normalizeAddress(value)).filter(Boolean)
    : [];
  const socketAddress = normalizeAddress(request?.socket?.remoteAddress);

  const firstXff = xffHops[0] || "";
  const lastXff = xffHops.at(-1) || "";
  let policyResolution = "unresolved";
  if (xRealIp) policyResolution = "x-real-ip";
  else if (xffHops.length === 1) policyResolution = "single-x-forwarded-for";
  else if (xffHops.length > 1) policyResolution = "ambiguous-x-forwarded-for";

  return {
    version: 1,
    xRealIpPresent: Boolean(xRealIp),
    xForwardedForPresent: xffHops.length > 0,
    xForwardedForHopCount: xffHops.length,
    socketAddressPresent: Boolean(socketAddress),
    xRealIpEqualsFirstXff: sameAddress(xRealIp, firstXff),
    xRealIpEqualsLastXff: sameAddress(xRealIp, lastXff),
    socketEqualsFirstXff: sameAddress(socketAddress, firstXff),
    socketEqualsLastXff: sameAddress(socketAddress, lastXff),
    policyResolution,
  };
}
