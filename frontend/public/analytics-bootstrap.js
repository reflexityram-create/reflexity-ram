window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
window.gtag("js", new Date());
// Route-level tracking is emitted by AnalyticsTracker after React has removed
// authentication, checkout, and guest-order query parameters.
window.gtag("config", "G-LHK5KZSYG6", { send_page_view: false });
