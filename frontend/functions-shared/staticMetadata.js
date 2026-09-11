import { applyStorefrontSecurityHeaders } from "./securityHeaders.js";

const ORIGIN = "https://reflexityram.com";
const MAX_HTML_BYTES = 128 * 1024;
const EMPTY_ROOT = /<div\s+id=(['"])root\1\s*><\/div>/i;

const PAGES = {
  "/": {
    title: "Wholesale Memory & IT Hardware — Reflexity",
    description: "Bulk RAM, server memory, storage, and IT hardware for resellers, refurbishers, businesses, and IT operators.",
    heading: "Wholesale memory and IT hardware",
    body: "Reflexity supplies and buys bulk RAM, server memory, storage, and related hardware through quote-based B2B relationships.",
    links: [["View inventory", "/inventory"], ["Request a quote", "/contact"], ["Sell hardware", "/sell-to-us"]],
  },
  "/inventory": {
    title: "Bulk RAM & IT Hardware Inventory — Reflexity",
    description: "Browse wholesale inventory types including server RAM, ECC RDIMMs, LRDIMMs, desktop and laptop memory, CPUs, and storage.",
    heading: "Wholesale inventory",
    body: "Browse available memory and hardware categories, then request availability and bulk pricing for your required part numbers and quantities.",
    links: [["Request bulk pricing", "/contact"], ["Wholesale supply", "/wholesale"]],
  },
  "/guides": {
    title: "Memory Compatibility Guides for IT Buyers — Reflexity",
    description: "Practical RAM reference guides for IT buyers: DDR generations, ECC, RDIMM, LRDIMM, part numbers, and compatibility.",
    heading: "Memory compatibility guides",
    links: [["Identify a RAM part number", "/guides/how-to-identify-ram"], ["View inventory", "/inventory"]],
  },
  "/guides/ddr4-vs-ddr5": {
    title: "DDR4 vs DDR5 for Bulk IT Procurement — Reflexity",
    description: "Compare DDR4 and DDR5 platform compatibility and sourcing considerations for business and IT hardware buyers.",
    heading: "DDR4 vs DDR5 for IT hardware buyers",
    body: "DDR4 and DDR5 are not interchangeable. Confirm platform support, capacity, speed, and form factor before requesting bulk availability.",
    links: [["View inventory", "/inventory"], ["Request a quote", "/contact"]],
  },
  "/guides/ecc-rdimm-udimm-explained": {
    title: "ECC, RDIMM, LRDIMM & UDIMM Guide — Reflexity",
    description: "Understand ECC, RDIMM, LRDIMM, and UDIMM compatibility when sourcing server and workstation memory in bulk.",
    heading: "ECC, RDIMM, LRDIMM, and UDIMM explained",
    body: "Registered, load-reduced, and unbuffered DIMMs serve different platforms and are usually not interchangeable. Confirm the server or motherboard memory rules first.",
    links: [["Browse server memory", "/inventory"], ["Ask about a part number", "/contact"]],
  },
  "/guides/how-to-identify-ram": {
    title: "Identify RAM by Part Number — Reflexity",
    description: "Use labels and manufacturer part numbers to identify RAM capacity, DDR generation, speed, form factor, ECC type, and rank.",
    heading: "Identify RAM from its label and part number",
    body: "Use the complete manufacturer part number, then confirm capacity, DDR generation, speed, form factor, ECC type, and rank against the target platform.",
    links: [["Search inventory", "/inventory"], ["Send purchase requirements", "/contact"]],
  },
  "/guides/how-much-ram-do-i-need": {
    title: "RAM Capacity Planning for Business Systems — Reflexity",
    description: "RAM capacity planning considerations for office systems, workstations, servers, virtual machines, and IT refresh projects.",
    heading: "Plan memory capacity for your systems",
    body: "Capacity needs depend on workload, virtualization, platform limits, and deployment plans. Include exact system and part-number requirements in a quote request.",
    links: [["View inventory", "/inventory"], ["Request a quote", "/contact"]],
  },
  "/wholesale": {
    title: "Wholesale IT Hardware Supply — Reflexity",
    description: "Bulk RAM and IT hardware supply for resellers, refurbishers, MSPs, system integrators, and server operators.",
    heading: "Wholesale supply relationships",
    body: "Reflexity works with businesses seeking lot-based memory and hardware supply, exact part-number availability, and repeat sourcing relationships.",
    links: [["View inventory", "/inventory"], ["Request bulk pricing", "/contact"]],
  },
  "/sell-to-us": {
    title: "Sell Bulk RAM & IT Hardware — Reflexity",
    description: "Sell bulk server RAM, desktop and laptop memory, CPUs, storage, servers, and related IT hardware to Reflexity.",
    heading: "Sell hardware to Reflexity",
    body: "Tell us the product type, part numbers, quantities, condition, and location. We review bulk hardware opportunities through a straightforward quote process.",
    links: [["Send hardware details", "/contact"], ["See what we supply", "/inventory"]],
  },
  "/contact": {
    title: "Request a Bulk Hardware Quote — Reflexity",
    description: "Contact Reflexity about bulk RAM, server memory, storage, and IT hardware availability, pricing, or acquisition opportunities.",
    heading: "Request availability or a bulk quote",
    body: "Send your part numbers, quantities, condition requirements, and location. Quote requests are enquiries and do not create an accepted purchase agreement.",
    links: [["View inventory", "/inventory"], ["Sell hardware", "/sell-to-us"]],
  },
  "/about": {
    title: "About Reflexity — Wholesale IT Hardware",
    description: "Reflexity is a quote-based supplier and buyer of bulk computer memory and related IT hardware.",
    heading: "About Reflexity",
    body: "Reflexity focuses on wholesale and bulk computer hardware enquiries rather than direct consumer ecommerce on this website.",
    links: [["Wholesale supply", "/wholesale"], ["Contact Reflexity", "/contact"]],
  },
  "/shipping": {
    title: "Shipping Information for Quote-Based Orders — Reflexity",
    description: "Shipping and delivery details are confirmed as part of accepted Reflexity wholesale transactions.",
    heading: "Shipping information",
    body: "Website inventory and quote submissions are enquiries. Shipping arrangements are confirmed separately when a transaction is accepted.",
    links: [["International enquiries", "/international"], ["Contact Reflexity", "/contact"]],
  },
  "/international": {
    title: "International Wholesale Hardware Enquiries — Reflexity",
    description: "Contact Reflexity about international bulk hardware supply or acquisition requirements.",
    heading: "International enquiries",
    body: "Share your location and requirements so shipping feasibility and transaction terms can be considered for the specific opportunity.",
    links: [["Request a quote", "/contact"], ["View inventory", "/inventory"]],
  },
  "/returns": {
    title: "Returns Information — Reflexity",
    description: "Returns and related terms for accepted Reflexity transactions are confirmed for the specific agreement.",
    heading: "Returns information",
    body: "Quote requests do not create an order. Any applicable return terms are confirmed for the accepted transaction rather than inferred from a website enquiry.",
    links: [["Warranty information", "/warranty"], ["Contact Reflexity", "/contact"]],
  },
  "/warranty": {
    title: "Warranty Information — Reflexity",
    description: "Warranty terms, where applicable, are confirmed for the specific Reflexity wholesale transaction.",
    heading: "Warranty information",
    body: "Product condition and any applicable warranty terms are discussed for the specific inventory and accepted transaction.",
    links: [["Returns information", "/returns"], ["Contact Reflexity", "/contact"]],
  },
  "/faq": {
    title: "Wholesale RAM & Hardware FAQ — Reflexity",
    description: "Answers about bulk memory, part-number availability, quote requests, hardware acquisition, and wholesale supply.",
    heading: "Wholesale hardware questions",
    links: [["Memory guides", "/guides"], ["Request a quote", "/contact"]],
  },
  "/privacy": {
    title: "Privacy Policy — Reflexity",
    description: "How Reflexity handles website and quote-enquiry information.",
    heading: "Privacy policy",
    links: [["Terms of service", "/terms"], ["Contact Reflexity", "/contact"]],
  },
  "/terms": {
    title: "Terms of Service — Reflexity",
    description: "Terms governing use of the Reflexity website and quote-based wholesale enquiries.",
    heading: "Terms of service",
    body: "Website inventory and quote submissions are enquiries only. They do not automatically form an accepted purchase agreement.",
    links: [["Privacy policy", "/privacy"], ["Contact Reflexity", "/contact"]],
  },
};

const CLIENT_ROUTE_PATTERNS = [
  /^\/admin(?:\/(?:products|wholesale|orders|users|security|sign-in))?$/,
  /^\/(?:auth\/callback|reset-password)$/,
  /^\/(?:inventory|wholesale)\/[^/]+$/,
];

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function insertBeforeHeadClose(html, tag) {
  return html.replace(/([ \t]*)<\/head>/i, (_match, indent) => `${indent}${tag}\n${indent}</head>`);
}

function upsertTitle(html, title) {
  const tag = `<title>${escapeHtml(title)}</title>`;
  return /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html) ? html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, tag) : insertBeforeHeadClose(html, tag);
}

function upsertMeta(html, attribute, key, content) {
  const tag = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}=(['"])${key}\\1[^>]*>`, "i");
  return pattern.test(html) ? html.replace(pattern, tag) : insertBeforeHeadClose(html, tag);
}

function upsertCanonical(html, canonicalUrl) {
  const tag = `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`;
  const pattern = /<link\b(?=[^>]*\brel=(['"])canonical\1)[^>]*>/i;
  return pattern.test(html) ? html.replace(pattern, tag) : insertBeforeHeadClose(html, tag);
}

export function injectStaticPage(html, page, pathname) {
  const canonicalUrl = `${ORIGIN}${pathname === "/" ? "" : pathname}`;
  let output = upsertTitle(html, page.title);
  output = upsertMeta(output, "name", "description", page.description);
  output = upsertMeta(output, "property", "og:title", page.title);
  output = upsertMeta(output, "property", "og:description", page.description);
  output = upsertMeta(output, "property", "og:url", canonicalUrl);
  output = upsertMeta(output, "name", "twitter:title", page.title);
  output = upsertMeta(output, "name", "twitter:description", page.description);
  output = upsertCanonical(output, canonicalUrl);
  const links = page.links.map(([label, href]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join("");
  const body = `<div id="root"><main data-edge-content="static"><nav><a href="/">Reflexity</a> · <a href="/inventory">Inventory</a> · <a href="/wholesale">Wholesale</a> · <a href="/contact">Contact</a></nav><article><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.body || page.description)}</p><ul>${links}</ul></article></main></div>`;
  return output.replace(/<div\s+id=(['"])root\1\s*><\/div>/i, body);
}

function responseWithHeaders(response, body, source, status = response.status) {
  const headers = applyStorefrontSecurityHeaders(new Headers(response.headers));
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("X-Reflexity-SEO", source);
  return new Response(body, { status, statusText: status === response.status ? response.statusText : "Not Found", headers });
}

function isKnownClientRoute(pathname) {
  return Boolean(PAGES[pathname]) || CLIENT_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

function canRewriteShell(html) {
  return new TextEncoder().encode(html).byteLength <= MAX_HTML_BYTES && EMPTY_ROOT.test(html);
}

function injectNotFoundPage(html) {
  let output = upsertTitle(html, "Page not found | Reflexity");
  output = upsertMeta(output, "name", "robots", "noindex, nofollow");
  output = upsertMeta(output, "name", "description", "The requested Reflexity page was not found.");
  const body = `<div id="root"><main data-edge-content="not-found"><h1>Page not found</h1><p>The requested page is unavailable.</p><a href="/">Return to Reflexity</a></main></div>`;
  return output.replace(EMPTY_ROOT, body);
}

function standaloneNotFoundPage() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="robots" content="noindex, nofollow" /><title>Page not found | Reflexity</title></head><body><main data-edge-content="not-found"><h1>Page not found</h1><p>The requested page is unavailable.</p><a href="/">Return to Reflexity</a></main></body></html>';
}

export async function renderStaticPage(context) {
  const method = context.request.method.toUpperCase();
  const shell = await context.next();
  const pathname = new URL(context.request.url).pathname.replace(/\/$/, "") || "/";
  const knownClientRoute = isKnownClientRoute(pathname);
  if (method === "HEAD" && !knownClientRoute && shell.ok) return responseWithHeaders(shell, null, "static-not-found", 404);
  if (method !== "GET") return responseWithHeaders(shell, method === "HEAD" ? null : shell.body, "spa-pass-through");
  if (!knownClientRoute && shell.ok && (shell.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
    const html = await shell.text();
    return responseWithHeaders(shell, canRewriteShell(html) ? injectNotFoundPage(html) : standaloneNotFoundPage(), "static-not-found", 404);
  }
  const page = PAGES[pathname];
  if (!page || !shell.ok || !(shell.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
    return responseWithHeaders(shell, shell.body, "spa-pass-through");
  }
  const html = await shell.text();
  if (!canRewriteShell(html)) {
    return responseWithHeaders(shell, html, "spa-pass-through");
  }
  return responseWithHeaders(shell, injectStaticPage(html, page, pathname), "static-edge");
}
