// Keep localhost, preview deployments, and provider QA out of the production
// property. Only the canonical customer host is allowed to load or emit GA4.
if (window.location.hostname === "reflexityram.com") {
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
