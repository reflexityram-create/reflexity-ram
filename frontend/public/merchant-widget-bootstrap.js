// Google's store rating badge (the Google Customer Reviews "store widget"). It shows nothing until
// Google has a rating for the store, then appears bottom-right on its own; nothing here is ours to
// fake or edit. Only the canonical customer host loads it, never the private pages, and on phones
// it sits above the sticky buy bar.
// A function scope on purpose: classic scripts share one global scope, and analytics-bootstrap.js already
// declares its own `privatePath`.
(() => {
  const privatePath = /^\/(admin|auth|account|reset-password|verify-email|review|wholesale-lab|wholesale-admin-lab)(\/|$)/;
  if (window.location.hostname === "reflexityram.com" && !privatePath.test(window.location.pathname)) {
    const widgetScript = document.createElement("script");
    widgetScript.id = "merchantWidgetScript";
    widgetScript.defer = true;
    widgetScript.src = "https://www.gstatic.com/shopping/merchant/merchantwidget.js";
    widgetScript.addEventListener("load", () => {
      window.merchantwidget.start({ position: "RIGHT_BOTTOM", mobileBottomMargin: 84 });
    });
    document.head.appendChild(widgetScript);
    // Google's script creates this iframe without a title, which screen readers announce as an unnamed frame (axe "frame-title").
    const nameFrame = () => {
      const frame = document.getElementById("merchantwidgetiframe");
      if (!frame) return false;
      if (!frame.getAttribute("title")) frame.setAttribute("title", "Google customer reviews badge");
      return true;
    };
    const Observer = window.MutationObserver;
    if (!nameFrame() && Observer) {
      const watcher = new Observer(() => { if (nameFrame()) watcher.disconnect(); });
      watcher.observe(document.documentElement, { childList: true, subtree: true });
      window.setTimeout(() => watcher.disconnect(), 30000);
    }
  }
})();
