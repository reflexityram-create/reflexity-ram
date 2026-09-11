import { applyStorefrontSecurityHeaders } from "./securityHeaders.js";

const BACKEND_ORIGIN = "https://reflexity-ram.onrender.com";
const ORIGIN = "https://reflexityram.com";
const LOT_ID = /^[a-f\d]{24}$/i;
const FETCH_BUDGET_MS = 2500;
const escapeHtml = (value) => String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const insertHead = (html, tag) => html.replace(/([ \t]*)<\/head>/i, (_match, indent) => `${indent}${tag}\n${indent}</head>`);
const replaceTitle = (html, title) => /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html) ? html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`) : insertHead(html, `<title>${escapeHtml(title)}</title>`);
const replaceMeta = (html, attribute, name, content) => {
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`;
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}=(['"])${name}\\1[^>]*>`, "i");
  return pattern.test(html) ? html.replace(pattern, tag) : insertHead(html, tag);
};

function withHeaders(response, body, source, status = response.status) {
  const headers = applyStorefrontSecurityHeaders(new Headers(response.headers));
  if (typeof body === "string") for (const name of ["Content-Length", "Content-Encoding", "ETag", "Last-Modified"]) headers.delete(name);
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("X-Reflexity-SEO", source);
  return new Response(body, { status, headers });
}

async function lotNotFound(shell, method) {
  if (method === "HEAD") return withHeaders(shell, null, "wholesale-lot-not-found", 404);
  const html = await shell.text();
  const body = /<\/head>/i.test(html) ? replaceMeta(replaceTitle(html, "Wholesale lot not found | Reflexity"), "name", "robots", "noindex, nofollow") : '<!doctype html><html lang="en"><head><meta name="robots" content="noindex, nofollow" /><title>Wholesale lot not found | Reflexity</title></head><body><main><h1>Wholesale lot not found</h1></main></body></html>';
  return withHeaders(shell, body, "wholesale-lot-not-found", 404);
}

function timeout(promise, milliseconds) {
  return new Promise((resolve) => { let done = false; const timer = setTimeout(() => { done = true; resolve({ kind: "timeout" }); }, milliseconds); promise.then((value) => { if (!done) { clearTimeout(timer); done = true; resolve(value); } }, (error) => { if (!done) { clearTimeout(timer); done = true; resolve({ kind: "error", error }); } }); });
}

async function loadLot(id, fetchImpl) {
  const response = await fetchImpl(new URL(`/api/wholesale/${id}`, BACKEND_ORIGIN), { headers: { Accept: "application/json" }, cf: { cacheEverything: true, cacheTtl: 300 } });
  if (response.status === 404) return { kind: "not-found" };
  if (!response.ok) throw new Error(`wholesale API returned ${response.status}`);
  const payload = await response.json();
  if (!payload?.lot || typeof payload.lot !== "object") throw new Error("wholesale API response did not contain a lot");
  return { kind: "lot", lot: payload.lot };
}

function injectLot(html, lot, id) {
  const title = String(lot.title || "Wholesale memory lot").slice(0, 140);
  const canonical = `${ORIGIN}/wholesale/${encodeURIComponent(id)}`;
  const details = [lot.brand, lot.mpn, lot.generation, lot.formFactor, lot.capacityLabel, lot.speedLabel].filter(Boolean).join(" · ");
  const description = `Wholesale availability for ${title}${details ? ` (${details})` : ""}. Request a quote for current quantity and lot terms.`.slice(0, 190);
  const image = typeof lot.imageUrl === "string" && lot.imageUrl.startsWith("https:") ? lot.imageUrl : `${ORIGIN}/og-image.svg`;
  let output = replaceTitle(html, `${title} — Wholesale Lot | Reflexity`);
  for (const [attribute, name, content] of [["name", "description", description], ["property", "og:title", title], ["property", "og:description", description], ["property", "og:type", "product"], ["property", "og:url", canonical], ["property", "og:image", image], ["name", "twitter:title", title], ["name", "twitter:description", description], ["name", "twitter:image", image]]) output = replaceMeta(output, attribute, name, content);
  output = output.replace(/<link\b(?=[^>]*\brel=(['"])canonical\1)[^>]*>/i, `<link rel="canonical" href="${canonical}" />`);
  if (!/rel=(['"])canonical\1/i.test(output)) output = insertHead(output, `<link rel="canonical" href="${canonical}" />`);
  const schema = { "@context": "https://schema.org", "@type": "Product", name: title, description, image: [image], sku: lot.lotCode || undefined, brand: lot.brand ? { "@type": "Brand", name: String(lot.brand).slice(0, 80) } : undefined };
  output = insertHead(output, `<script type="application/ld+json" data-edge-wholesale-lot>${safeJson(schema)}</script>`);
  const body = `<div id="root"><main data-edge-content="wholesale-lot"><nav><a href="/">Reflexity RAM</a> · <a href="/wholesale">Wholesale</a> · <a href="/support">Support</a></nav><article><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${details ? `<p>${escapeHtml(details)}</p>` : ""}<p><a href="/support">Request availability and bulk pricing</a> · <a href="/liquidators">Sell hardware to Reflexity</a></p></article></main></div>`;
  return output.replace(/<div\s+id=(['"])root\1\s*><\/div>/i, body);
}

export async function renderWholesaleLotPage(context, { fetchImpl = fetch, fetchBudgetMs = FETCH_BUDGET_MS } = {}) {
  const method = context.request.method.toUpperCase();
  const shellPromise = context.next();
  if (method !== "GET" && method !== "HEAD") { const shell = await shellPromise; return withHeaders(shell, method === "HEAD" ? null : shell.body, "spa-pass-through"); }
  const id = typeof context.params?.lotId === "string" ? context.params.lotId : "";
  if (!LOT_ID.test(id)) return lotNotFound(await shellPromise, method);
  const [shell, result] = await Promise.all([shellPromise, timeout(loadLot(id, fetchImpl), fetchBudgetMs)]);
  if (result.kind === "timeout" || result.kind === "error") return withHeaders(shell, method === "HEAD" ? null : shell.body, result.kind === "timeout" ? "spa-timeout-fallback" : "spa-error-fallback");
  if (result.kind === "not-found") return lotNotFound(shell, method);
  if (method === "HEAD") return withHeaders(shell, null, "wholesale-lot-edge");
  if (!shell.ok || !(shell.headers.get("Content-Type") || "").includes("text/html")) return withHeaders(shell, shell.body, "spa-pass-through");
  return withHeaders(shell, injectLot(await shell.text(), result.lot, id), "wholesale-lot-edge");
}
