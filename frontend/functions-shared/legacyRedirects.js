import { applyStorefrontSecurityHeaders } from "./securityHeaders.js";

const LEGACY_PATHS = new Map([
  ["/inventory", "/shop"],
  ["/sell-to-us", "/liquidators"],
  ["/contact", "/support"],
  ["/about", "/business-info"],
]);

export function permanentRedirect(request, destination) {
  const requestUrl = new URL(request.url);
  const location = new URL(destination, requestUrl.origin);
  location.search = requestUrl.search;
  const headers = applyStorefrontSecurityHeaders(new Headers());
  headers.set("Location", location.toString());
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(null, { status: 308, headers });
}

export function legacyRedirect(request) {
  const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  const destination = LEGACY_PATHS.get(pathname);
  return destination ? permanentRedirect(request, destination) : null;
}
