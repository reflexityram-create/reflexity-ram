// The admin Visitors page (pages/admin/Visitors.jsx): the grouping it shows, and that every way into it is wired.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeAdminTab } from "../src/lib/adminTabs.js";
import { agoText, deviceOf, groupVisitors, placeOf } from "../src/lib/visitors.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const CF = { city: "Toronto", region: "Ontario", country: "CA", as_org: "Bell Canada", browser: "Chrome", os: "Android", device: "mobile", site: "reflexityram.com" };
const visit = (ts, extra) => ({ id: ts, ts, ip: "203.0.113.7", path: "/shop", bot: 0, referrer: null, utm_source: null, ...CF, ...extra });

test("visits are grouped by IP address, newest person first, with where the visit started", () => {
  const people = groupVisitors([
    visit(5000, { path: "/cart" }),
    visit(4000, { ip: "198.51.100.5", city: "Ottawa", as_org: "Rogers", path: "/" }),
    visit(3000, { path: "/shop/x", referrer: "https://www.google.com/search", utm_source: "google" }),
    visit(1000, { path: "/", referrer: "https://old.example/", utm_source: null }),
  ]);
  assert.deepEqual(people.map((p) => p.ip), ["203.0.113.7", "198.51.100.5"]);
  const first = people[0];
  assert.equal(first.views.length, 3);
  assert.equal(first.place, "Toronto, Ontario, CA");
  assert.equal(first.network, "Bell Canada");
  assert.equal(first.device, "Chrome on Android (mobile)");
  assert.equal(first.referrer, "https://old.example/", "the oldest view that says where it came from");
  assert.equal(first.campaign, "google");
  assert.deepEqual([first.first, first.last], [1000, 5000]);
  assert.deepEqual(first.sites, ["reflexityram.com"]);
});

test("a visitor of several sites lists them all, a bot is flagged, and bad rows are skipped", () => {
  const people = groupVisitors([visit(2, { site: "starforgegta.ca" }), visit(1, { bot: 1 }), { ts: 3 }, null]);
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].sites.sort(), ["reflexityram.com", "starforgegta.ca"]);
  assert.equal(people[0].bot, true);
  assert.equal(placeOf({}), "Unknown place");
  assert.equal(deviceOf({ browser: "Firefox" }), "Firefox");
  assert.deepEqual(groupVisitors(), []);
});

test("how long ago reads in plain words", () => {
  const now = 10_000_000_000;
  assert.equal(agoText(now - 20_000, now), "just now");
  assert.equal(agoText(now - 5 * 60_000, now), "5 min ago");
  assert.equal(agoText(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(agoText(now - 72 * 3_600_000, now), "3 days ago");
});

test("the page is reachable: route, desktop sidebars, the More list, and it lights the More tab on a phone", () => {
  const app = read("../src/App.jsx");
  assert.match(app, /const AdminVisitors = lazy\(\(\) => import\("@\/pages\/admin\/Visitors"\)\)/);
  assert.match(app, /<Route path="\/admin\/visitors" element=\{<AdminVisitors \/>\} \/>/);
  assert.match(read("../src/components/AppLayout.jsx"), /to: '\/admin\/visitors', label: 'Visitors'/);
  assert.match(read("../src/components/AdminLayout.jsx"), /to: '\/admin\/visitors', label: 'Visitors'/);
  assert.match(read("../src/pages/admin/More.jsx"), /to: '\/admin\/visitors', icon: Eye, title: 'Visitors'/);
  assert.equal(activeAdminTab("/admin/visitors"), "more");
});

test("the page asks the server (never the collector, so no token is in the browser) and renders visitor data as text", () => {
  const page = read("../src/pages/admin/Visitors.jsx");
  const api = read("../src/lib/api.js");
  assert.match(api, /listVisits: \(params\) => api\.get\('\/admin\/visits', \{ params \}\)/);
  assert.match(api, /visitsSummary: \(params\) => api\.get\('\/admin\/visits\/summary', \{ params \}\)/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|innerHTML|visits\.reflexityram\.com|Bearer|VISITS_API/);
  assert.match(page, /requireAdmin/);
});
