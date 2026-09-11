const PRODUCTION_HOST = "reflexityram.com";
const PRIVATE_PATH_PREFIXES = [
  "/admin",
  "/auth",
  "/account",
  "/reset-password",
  "/verify-email",
  "/wholesale-lab",
  "/wholesale-admin-lab",
];
const INTERNAL_QUERY_KEYS = new Set([
  "qa",
  "verify",
  "deploy",
  "release",
  "diagnose",
  "demo",
  "image-hotfix",
]);

export function shouldTrackLocation(location = globalThis.location) {
  if (!location || location.hostname !== PRODUCTION_HOST) return false;
  const pathname = location.pathname || "/";
  if (PRIVATE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  const params = new URLSearchParams(location.search || "");
  return ![...params.keys()].some((key) => INTERNAL_QUERY_KEYS.has(key.toLowerCase()));
}

export function trackEvent(eventName, parameters = {}) {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(eventName)) return false;
  if (!shouldTrackLocation(globalThis.location) || typeof globalThis.gtag !== "function") return false;
  globalThis.gtag("event", eventName, parameters);
  return true;
}
