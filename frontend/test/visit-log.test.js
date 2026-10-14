// The first-party visit log's browser side (lib/analytics.js trackVisit): what it sends, and every case in which it must send nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ANALYTICS_OPTOUT_KEY, ANALYTICS_OWNER_KEY, trackVisit, visitPayload } from "../src/lib/analytics.js";

function browser({ url = "https://reflexityram.com/shop/rfx-samsung-64gb?utm_source=google&utm_medium=cpc&email=buyer@example.com#frag", referrer = "https://www.google.com/search?q=ram", stored = {}, nav = {} } = {}) {
  const beacons = [];
  const fetched = [];
  const local = new Map(Object.entries(stored));
  const session = new Map();
  const saved = {};
  const set = (key, value) => { saved[key] = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); };
  set("location", new URL(url));
  set("document", { title: "Samsung 64GB DDR4 — Reflexity RAM", referrer });
  set("localStorage", { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, v), removeItem: (k) => local.delete(k) });
  set("sessionStorage", { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, v) });
  set("screen", { width: 412, height: 915 });
  set("navigator", { language: "en-CA", sendBeacon: (u, b) => { beacons.push([u, b]); return true; }, ...nav });
  set("fetch", (u, init) => { fetched.push([u, init]); return Promise.resolve(); });
  return {
    beacons, fetched, local, session,
    body: (n = 0) => JSON.parse(beacons[n][1].parts?.[0] ?? "null"),
    restore: () => { for (const [key, desc] of Object.entries(saved)) { if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key]; } },
  };
}

// node's Blob has no synchronous text(): keep the parts so a test can read what was sent
const RealBlob = globalThis.Blob;
globalThis.Blob = class extends RealBlob { constructor(parts, options) { super(parts, options); this.parts = parts; } };

test("a public page view is reported to our collector with the safe page, campaign, referrer origin and tab-session id", () => {
  const b = browser();
  try {
    assert.equal(trackVisit("/shop/rfx-samsung-64gb"), true);
    assert.equal(b.beacons.length, 1);
    assert.equal(b.beacons[0][0], "https://visits.reflexityram.com/v");
    assert.equal(b.beacons[0][1].type, "text/plain", "a simple request: no preflight, no cookie");
    const body = b.body();
    assert.equal(body.s, "reflexityram.com");
    assert.equal(body.p, "/shop/rfx-samsung-64gb");
    assert.equal(body.t, "Memory product — Reflexity RAM", "the same product-free title GA4 gets");
    assert.equal(body.r, "https://www.google.com", "the referrer is an origin, never a path or query");
    assert.deepEqual(body.u, { utm_source: "google", utm_medium: "cpc" });
    assert.equal(body.l, "en-CA");
    assert.equal(body.w, "412x915");
    assert.match(body.i, /^[a-z0-9]{8,}$/, "a random id of this tab session");
    assert.doesNotMatch(JSON.stringify(body), /buyer@example\.com|frag/, "nothing from the query string or fragment, apart from utm tags");
    assert.equal(b.session.get("reflexity_visit_sid"), body.i);
  } finally { b.restore(); }
});

test("the next page of the same visit repeats the session id but not the referrer", () => {
  const b = browser({ url: "https://reflexityram.com/cart" });
  try {
    assert.equal(trackVisit("/cart"), true);
    assert.equal(b.body().r, "", "the first report of this page load already carried the referrer");
    const first = b.body().i;
    b.session.set("reflexity_visit_sid", first);
    assert.equal(trackVisit("/cart"), true);
    assert.equal(b.body(1).i, first);
  } finally { b.restore(); }
});

test("order links and other private paths never leave the browser with their tokens", () => {
  const b = browser({ url: "https://reflexityram.com/order/RFX-SECRET-TOKEN-1234" });
  try {
    assert.equal(trackVisit("/order/RFX-SECRET-TOKEN-1234"), true);
    assert.equal(b.body().p, "/order/success", "an order page is one path, as for GA4");
    for (const url of ["https://reflexityram.com/admin/orders", "https://reflexityram.com/account", "https://reflexityram.com/review#t=r1.token", "https://reflexityram.com/reset-password/abc", "https://reflexityram.com/shop?qa=1"]) {
      const c = browser({ url });
      try { assert.equal(trackVisit(new URL(url).pathname), false, url); assert.equal(c.beacons.length + c.fetched.length, 0, url); } finally { c.restore(); }
    }
  } finally { b.restore(); }
});

test("nothing is sent from another host, for the owner, for an opted-out browser, a QA session, Do Not Track or Global Privacy Control", () => {
  const cases = [
    ["a preview host", { url: "https://reflexity-ram-3rn.pages.dev/shop" }],
    ["localhost", { url: "http://localhost:5173/shop" }],
    ["www (redirects to the canonical host)", { url: "https://www.reflexityram.com/shop" }],
    ["the owner after visiting /admin", { stored: { [ANALYTICS_OWNER_KEY]: "1" } }],
    ["a browser that opted out", { stored: { [ANALYTICS_OPTOUT_KEY]: "1" } }],
    ["?analytics=off", { url: "https://reflexityram.com/shop?analytics=off" }],
    ["Do Not Track", { nav: { doNotTrack: "1" } }],
    ["Global Privacy Control", { nav: { globalPrivacyControl: true } }],
  ];
  for (const [name, options] of cases) {
    const b = browser(options);
    try {
      assert.equal(trackVisit(globalThis.location.pathname), false, name);
      assert.equal(b.beacons.length + b.fetched.length, 0, `${name}: no request of any kind`);
    } finally { b.restore(); }
  }
});

test("without sendBeacon the report goes out as a keepalive no-cors text/plain post, and a failure never reaches the page", () => {
  const b = browser({ nav: { sendBeacon: undefined } });
  try {
    assert.equal(trackVisit("/shop"), true);
    assert.equal(b.fetched.length, 1);
    assert.equal(b.fetched[0][1].keepalive, true);
    assert.equal(b.fetched[0][1].mode, "no-cors");
    assert.equal(b.fetched[0][1].headers["Content-Type"], "text/plain");
  } finally { b.restore(); }
  const broken = browser({ nav: { sendBeacon: () => { throw new Error("blocked"); } } });
  try { assert.doesNotThrow(() => trackVisit("/shop")); } finally { broken.restore(); }
});

test("the payload is small, flat and carries no cookie, name, email or order detail", () => {
  const b = browser({ url: "https://reflexityram.com/checkout?email=a@b.c&name=Bob" });
  try {
    const payload = visitPayload("/checkout");
    assert.deepEqual(Object.keys(payload).sort(), ["i", "l", "p", "r", "s", "t", "u", "w", "z"]);
    assert.ok(JSON.stringify(payload).length < 600);
    assert.doesNotMatch(JSON.stringify(payload), /a@b\.c|Bob/);
  } finally { b.restore(); }
});

test("the page is allowed to report: connect-src names the collector in both copies of the CSP, and script-src does not", () => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../functions-shared/securityHeaders.js", import.meta.url), "utf8");
  for (const [name, text] of [["_headers", headers], ["securityHeaders.js", shared]]) {
    const connect = /connect-src ([^;"]*)/.exec(text)?.[1] || "";
    const script = /script-src ([^;"]*)/.exec(text)?.[1] || "";
    assert.match(connect, /https:\/\/visits\.reflexityram\.com/, `${name}: connect-src`);
    assert.doesNotMatch(script, /visits\.reflexityram\.com/, `${name}: no script from the collector (the React app reports natively)`);
  }
});

test("the privacy page says an IP address is logged, what else, for how long, and how to opt out", () => {
  const privacy = readFileSync(new URL("../src/pages/policies/Privacy.jsx", import.meta.url), "utf8");
  assert.match(privacy, /Visit log/);
  assert.match(privacy, /IP address/);
  assert.match(privacy, /180 days/);
  assert.match(privacy, /\?analytics=off/);
  assert.match(privacy, /Do Not Track/);
  assert.match(privacy, /sets no cookie/);
  // every field the payload carries is named: network, language, screen size, time zone, campaign tags, referrer, pages
  for (const word of [/network/, /language/, /screen size/, /time zone/, /campaign tags/, /website that sent you/, /pages you open/]) assert.match(privacy, word);
});

test("the page tracker reports every public page view, before (and whether or not) GA4 has loaded, and clears its timer on every exit", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const tracker = app.slice(app.indexOf("function AnalyticsTracker()"));
  const visit = tracker.indexOf("const visitTimer = window.setTimeout(() => trackVisit(safePath), 0);");
  const gtagGate = tracker.indexOf('typeof window.gtag !== "function"');
  assert.ok(visit > 0 && gtagGate > visit, "trackVisit is scheduled before the gtag early return");
  assert.match(tracker, /return \(\) => window\.clearTimeout\(visitTimer\);/, "the early return clears it");
  assert.match(tracker, /window\.clearTimeout\(visitTimer\);\s*window\.clearTimeout\(viewTimer\);/, "the normal cleanup clears it");
  assert.match(app, /trackVisit,\s*\} from "@\/lib\/analytics";/);
});

test("only the storefront's own public pages are recorded by address; any other address is recorded as /other", async () => {
  const { visitPath } = await import("../src/lib/analytics.js");
  for (const [path, expected] of [
    ["/", "/"], ["/shop", "/shop"], ["/shop/rfx-samsung-64gb-ddr4-3200-ecc-registered-rdimm-serv", "/shop/rfx-samsung-64gb-ddr4-3200-ecc-registered-rdimm-serv"],
    ["/guides/how-to-identify-ram", "/guides/how-to-identify-ram"], ["/checkout/e-transfer", "/checkout/e-transfer"], ["/order/RFX-SECRET-TOKEN-1234", "/order/success"],
    ["/wholesale/6532f0b2c1d4a5e6f7089abc", "/wholesale/lot"], ["/privacy", "/privacy"],
    ["/buyer@example.com", "/other"], ["/john.smith", "/other"], ["/shop/Rfx-With-Capitals", "/other"], ["/shop/a/b", "/other"], ["/wp-login.php", "/other"], ["/claim/AbCdEfGhIjKlMnOpQrSt1234", "/other"],
  ]) assert.equal(visitPath(path), expected, path);
});

test("every public route in App.jsx is recorded by its own address (a new public page must be added to the list)", async () => {
  const { visitPath } = await import("../src/lib/analytics.js");
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  const privateRoute = /^(\*|\/admin|\/account|\/auth|\/reset-password|\/review|\/verify-email)|-lab/;
  const sample = (route) => route.replace(/:slug/, "rfx-sample-product").replace(/:orderNumber/, "RFX-ABC-123").replace(/:lotId/, "lot1");
  const publicRoutes = routes.filter((route) => !privateRoute.test(route));
  assert.ok(publicRoutes.length >= 20 && publicRoutes.includes("/checkout/e-transfer"), "the routes were read");
  for (const route of publicRoutes) {
    const got = visitPath(sample(route));
    assert.notEqual(got, "/other", `${route} is a public page but is recorded as /other: add it to VISIT_PATHS`);
  }
  // and the private ones are never reported at all (shouldTrackLocation), so they need no entry
  for (const route of routes.filter((r) => /^\/(admin|account|reset-password|review|verify-email)/.test(r))) assert.equal(visitPath(sample(route)), "/other", route);
});
