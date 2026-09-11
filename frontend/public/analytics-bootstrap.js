// Keep localhost, preview deployments, and provider QA out of the production
// property. Only the canonical customer host is allowed to load or emit GA4.
const privatePath = /^\/(admin|auth|account|reset-password|verify-email|wholesale-lab|wholesale-admin-lab)(\/|$)/;
const internalKeys = new Set(["qa", "verify", "deploy", "release", "diagnose", "demo", "image-hotfix"]);
const internalVisit = [...new URLSearchParams(window.location.search).keys()]
  .some((key) => internalKeys.has(key.toLowerCase()));
if (window.location.hostname === "reflexityram.com" && !privatePath.test(window.location.pathname) && !internalVisit) {
  const analyticsScript = document.createElement("script");
  analyticsScript.async = true;
  analyticsScript.src = "https://www.googletagmanager.com/gtag/js?id=G-LHK5KZSYG6";
  document.head.appendChild(analyticsScript);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  // Route-level tracking is emitted by AnalyticsTracker after React has removed
  // authentication, checkout, and guest-order query parameters.
  window.gtag("config", "G-LHK5KZSYG6", { send_page_view: false });
}
