import { applyStorefrontSecurityHeaders } from "./securityHeaders.js";

const ORIGIN = "https://reflexityram.com";
const MAX_HTML_BYTES = 128 * 1024;

const PAGES = {
  "/": {
    title: "Tested DDR4 & DDR5 RAM in Canada — Reflexity RAM",
    description: "Shop individually tested DDR4 and DDR5 memory for desktops, laptops, workstations, and servers, shipped from Toronto.",
    heading: "Tested DDR4 and DDR5 RAM, shipped from Toronto",
    links: [["Shop tested RAM", "/shop"], ["Find the right memory", "/guides/how-to-identify-ram"]],
  },
  "/shop": {
    title: "Shop Tested DDR4 & DDR5 RAM in Canada — Reflexity RAM",
    description: "Browse tested desktop, laptop, workstation, and server RAM with clear compatibility details and warranty coverage.",
    heading: "Shop tested computer and server memory",
    links: [["Browse RAM categories", "/categories"], ["RAM compatibility guides", "/guides"]],
  },
  "/categories": {
    title: "DDR4, DDR5, Laptop & Server RAM Categories — Reflexity RAM",
    description: "Browse tested RAM by DDR generation, form factor, use case, and capacity for desktops, laptops, workstations, and servers.",
    heading: "Browse RAM by type and use case",
    links: [["Shop all tested RAM", "/shop"], ["How to identify RAM", "/guides/how-to-identify-ram"]],
  },
  "/guides": {
    title: "RAM Compatibility & Buying Guides — Reflexity RAM",
    description: "Practical guides to DDR4, DDR5, ECC, RDIMM, LRDIMM, laptop, desktop, server memory, and capacity.",
    heading: "RAM compatibility and buying guides",
    links: [["How to identify RAM", "/guides/how-to-identify-ram"], ["DDR4 vs DDR5", "/guides/ddr4-vs-ddr5"], ["ECC and RDIMM explained", "/guides/ecc-rdimm-udimm-explained"]],
  },
  "/guides/ddr4-vs-ddr5": {
    title: "DDR4 or DDR5? Compatibility, Speed & Upgrade Guide — Reflexity RAM",
    description: "Compare DDR4 and DDR5 compatibility, speed, price, and upgrade value before buying desktop or laptop memory.",
    heading: "DDR4 or DDR5: which memory should you buy?",
    body: "DDR4 and DDR5 are not interchangeable. Your motherboard and processor determine which generation fits; capacity usually matters more than a small speed increase.",
    links: [["Browse RAM categories", "/categories"], ["Shop tested RAM", "/shop"]],
  },
  "/guides/ecc-rdimm-udimm-explained": {
    title: "RDIMM vs UDIMM: ECC, LRDIMM & Server RAM Explained — Reflexity RAM",
    description: "Understand ECC, RDIMM, LRDIMM, and UDIMM differences before choosing compatible server or workstation memory.",
    heading: "RDIMM vs UDIMM, ECC, and LRDIMM explained",
    body: "Registered, load-reduced, and unbuffered DIMMs serve different platforms and are usually not interchangeable. Check the server or motherboard memory rules before ordering.",
    links: [["Shop tested server RAM", "/shop"], ["Ask about compatibility", "/support"]],
  },
  "/guides/how-to-identify-ram": {
    title: "How to Identify RAM: Labels & Part Numbers — Reflexity RAM",
    description: "Read a RAM label and part number to identify capacity, DDR generation, speed, form factor, ECC type, and rank.",
    heading: "How to identify RAM from its label and part number",
    body: "Use the complete manufacturer part number, then verify capacity, DDR generation, speed, form factor, ECC type, and rank against the computer or server manual.",
    links: [["Search the RAM catalog", "/shop"], ["Ask us to identify a module", "/support"]],
  },
  "/guides/how-much-ram-do-i-need": {
    title: "How Much RAM Do I Need? Capacity Guide — Reflexity RAM",
    description: "Choose RAM capacity for office work, gaming, content creation, virtual machines, workstations, and servers.",
    heading: "How much RAM do you need?",
    body: "Sixteen gigabytes is a practical everyday baseline, 32GB adds headroom, and professional or server workloads may need 64GB or more.",
    links: [["Browse RAM categories", "/categories"], ["Shop tested RAM", "/shop"]],
  },
  "/wholesale": {
    title: "Wholesale Tested RAM Lots in Canada — Reflexity RAM",
    description: "Browse posted wholesale lots of tested server and computer memory, with quantities and inquiry details.",
    heading: "Wholesale tested RAM lots",
    links: [["View retail RAM", "/shop"], ["Contact Reflexity RAM", "/support"]],
  },
  "/liquidators": {
    title: "IT Asset Liquidation in Toronto — Reflexity Liquidators",
    description: "Sell decommissioned servers, RAM, drives, and networking gear in bulk with one quote and GTA pickup or prepaid shipping.",
    heading: "Sell retired servers, RAM, drives, and networking gear",
    links: [["See what we buy", "/liquidators#what-we-take"], ["View wholesale stock", "/wholesale"]],
  },
  "/support": {
    title: "RAM Compatibility & Order Support — Reflexity RAM",
    description: "Get help with RAM compatibility, orders, shipping, returns, and warranty from Reflexity RAM.",
    heading: "Reflexity RAM support",
    links: [["Frequently asked questions", "/faq"], ["Shipping information", "/shipping"], ["Shop tested RAM", "/shop"]],
  },
  "/business-info": {
    title: "Business Information — Reflexity RAM",
    description: "Business identity, contact, and operating information for Reflexity RAM, an independent online memory retailer in Toronto.",
    heading: "Reflexity RAM business information",
    links: [["Contact support", "/support"], ["Shop tested RAM", "/shop"]],
  },
  "/shipping": {
    title: "Shipping Information — Reflexity RAM",
    description: "Shipping rates, destinations, handling, tracking, and delivery information for Reflexity RAM orders.",
    heading: "Shipping information",
    links: [["International orders", "/international"], ["Contact support", "/support"]],
  },
  "/international": {
    title: "International RAM Orders — Reflexity RAM",
    description: "How to request custom shipping for Reflexity RAM orders outside Canada and the United States.",
    heading: "International RAM orders",
    links: [["Contact support", "/support"], ["Shop tested RAM", "/shop"]],
  },
  "/returns": {
    title: "Returns Policy — Reflexity RAM",
    description: "Return eligibility, time limits, condition requirements, and the return process for Reflexity RAM purchases.",
    heading: "Returns policy",
    links: [["Warranty coverage", "/warranty"], ["Contact support", "/support"]],
  },
  "/warranty": {
    title: "RAM Warranty Coverage — Reflexity RAM",
    description: "Warranty coverage and claim steps for tested memory purchased from Reflexity RAM.",
    heading: "RAM warranty coverage",
    links: [["Returns policy", "/returns"], ["Contact support", "/support"]],
  },
  "/faq": {
    title: "Frequently Asked RAM Questions — Reflexity RAM",
    description: "Answers about RAM compatibility, testing, orders, shipping, returns, warranty, and wholesale purchases.",
    heading: "Frequently asked questions",
    links: [["RAM buying guides", "/guides"], ["Contact support", "/support"]],
  },
  "/privacy": {
    title: "Privacy Policy — Reflexity RAM",
    description: "How Reflexity RAM collects, uses, protects, and retains customer and website information.",
    heading: "Privacy policy",
    links: [["Terms of service", "/terms"], ["Contact support", "/support"]],
  },
  "/terms": {
    title: "Terms of Service — Reflexity RAM",
    description: "Terms governing purchases and use of the Reflexity RAM website and services.",
    heading: "Terms of service",
    links: [["Privacy policy", "/privacy"], ["Contact support", "/support"]],
  },
};

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
  const body = `<div id="root"><main data-edge-content="static"><nav><a href="/">Reflexity RAM</a> · <a href="/shop">Shop</a> · <a href="/guides">Guides</a></nav><article><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.body || page.description)}</p><ul>${links}</ul></article></main></div>`;
  return output.replace(/<div\s+id=(['"])root\1\s*><\/div>/i, body);
}

function responseWithHeaders(response, body, source) {
  const headers = applyStorefrontSecurityHeaders(new Headers(response.headers));
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("X-Reflexity-SEO", source);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export async function renderStaticPage(context) {
  const method = context.request.method.toUpperCase();
  const shell = await context.next();
  if (method !== "GET") return responseWithHeaders(shell, method === "HEAD" ? null : shell.body, "spa-pass-through");
  const pathname = new URL(context.request.url).pathname.replace(/\/$/, "") || "/";
  const page = PAGES[pathname];
  if (!page || !shell.ok || !(shell.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
    return responseWithHeaders(shell, shell.body, "spa-pass-through");
  }
  const html = await shell.text();
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES || !/<div\s+id=(['"])root\1\s*><\/div>/i.test(html)) {
    return responseWithHeaders(shell, html, "spa-pass-through");
  }
  return responseWithHeaders(shell, injectStaticPage(html, page, pathname), "static-edge");
}
