// What the admin "Visitors" page shows (pages/admin/Visitors.jsx): the visit log (docs/visit-log.md) grouped by IP address.
// Plain functions so the grouping can be tested without a browser.
export const PERIODS = Object.freeze([
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
]);

export const placeOf = (visit) => [visit.city, visit.region, visit.country].filter(Boolean).join(', ') || 'Unknown place';

export const deviceOf = (visit) => {
  const base = [visit.browser, visit.os].filter(Boolean).join(' on ');
  return [base, visit.device ? `(${visit.device})` : ''].filter(Boolean).join(' ');
};

/** One entry per IP address, most recent first. `views` keep the order the log returned them in (newest first). */
export function groupVisitors(visits = []) {
  const byIp = new Map();
  for (const visit of visits) {
    if (!visit?.ip) continue;
    let group = byIp.get(visit.ip);
    if (!group) {
      group = { ip: visit.ip, place: placeOf(visit), network: visit.as_org || '', device: deviceOf(visit), bot: false, views: [], first: visit.ts, last: visit.ts, sites: new Set(), referrer: '', campaign: '' };
      byIp.set(visit.ip, group);
    }
    group.views.push(visit);
    group.first = Math.min(group.first, visit.ts);
    group.last = Math.max(group.last, visit.ts);
    group.sites.add(visit.site);
    if (visit.bot) group.bot = true;
  }
  for (const group of byIp.values()) {
    // where the visit started: the oldest view that says where it came from
    const oldestFirst = [...group.views].sort((a, b) => a.ts - b.ts);
    group.referrer = oldestFirst.find((v) => v.referrer)?.referrer || '';
    group.campaign = oldestFirst.find((v) => v.utm_source)?.utm_source || '';
    group.sites = [...group.sites];
  }
  return [...byIp.values()].sort((a, b) => b.last - a.last);
}

export function agoText(ms, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
