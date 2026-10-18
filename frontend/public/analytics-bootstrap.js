// Keep localhost, preview deployments, and provider QA out of the production
// property. Only the canonical customer host is allowed to load or emit GA4.
const privatePath = /^\/(admin|auth|account|reset-password|verify-email|review|wholesale-lab|wholesale-admin-lab)(\/|$)/;
const internalKeys = new Set(["qa", "verify", "deploy", "release", "diagnose", "demo", "image-hotfix"]);
const params = new URLSearchParams(window.location.search);
const preference = params.get("analytics")?.toLowerCase();
const qaVisit = [...params.keys()].some((key) => key.toLowerCase() === "qa");
try {
  if (preference === "off") window.localStorage.setItem("reflexity_analytics_optout", "1");
  if (preference === "on") {
    window.localStorage.removeItem("reflexity_analytics_optout");
    window.localStorage.removeItem("reflexity_analytics_owner");
  }
  // Visiting an admin route marks this browser as operator-owned. This keeps
  // later public browsing out of the customer reports until ?analytics=on.
  if (/^\/admin(?:\/|$)/.test(window.location.pathname)) {
    window.localStorage.setItem("reflexity_analytics_owner", "1");
  }
} catch { /* blocked storage: route and query exclusions still apply */ }
try { if (qaVisit) window.sessionStorage.setItem("reflexity_analytics_qa", "1"); } catch { /* blocked storage */ }
const internalVisit = [...params.keys()].some((key) => internalKeys.has(key.toLowerCase()));
let optedOut = false;
try { optedOut = Boolean(window.localStorage.getItem("reflexity_analytics_optout") || window.localStorage.getItem("reflexity_analytics_owner")); } catch { /* no-op */ }
let qaSession = false;
try { qaSession = Boolean(window.sessionStorage.getItem("reflexity_analytics_qa")); } catch { /* no-op */ }
const analyticsDisabled = optedOut || qaSession || privatePath.test(window.location.pathname);
try { window[`ga-disable-G-LHK5KZSYG6`] = analyticsDisabled; } catch { /* no-op */ }
if (window.location.hostname === "reflexityram.com" && !analyticsDisabled && !privatePath.test(window.location.pathname) && !internalVisit) {
  const analyticsScript = document.createElement("script");
  analyticsScript.async = true;
  analyticsScript.src = "https://www.googletagmanager.com/gtag/js?id=G-LHK5KZSYG6";
  document.head.appendChild(analyticsScript);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  // Manual page views omit the query for privacy. Map safe landing tags to
  // GA's campaign fields so those visits retain their source and medium.
  const campaigns = {};
  for (const [query, field] of [
    ["utm_source", "campaign_source"], ["utm_medium", "campaign_medium"],
    ["utm_campaign", "campaign_name"], ["utm_term", "campaign_term"],
    ["utm_content", "campaign_content"],
  ]) {
    const value = params.get(query);
    if (value && /^[A-Za-z0-9._~-]{1,100}$/.test(value)) campaigns[field] = value;
  }
  // Route-level tracking is emitted by AnalyticsTracker after React has removed
  // authentication, checkout, and guest-order query parameters.
  window.gtag("config", "G-LHK5KZSYG6", { send_page_view: false, ...campaigns });
}
