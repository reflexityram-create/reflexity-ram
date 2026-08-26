export const STOREFRONT_SECURITY_HEADERS = Object.freeze({
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com https://apis.google.com https://www.gstatic.com https://www.google.com; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://res.cloudinary.com https://www.google-analytics.com https://*.googleusercontent.com; connect-src 'self' https://reflexity-ram.onrender.com https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com; frame-src https://accounts.google.com https://www.google.com; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests",
});

export function applyStorefrontSecurityHeaders(headers = new Headers()) {
  for (const [name, value] of Object.entries(STOREFRONT_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}
