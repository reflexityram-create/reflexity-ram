import { useEffect } from "react";

const MERCHANT_ID = 5832020811;

function dateOnly(value, fallback) {
  const date = new Date(value || fallback || Date.now());
  if (!value) date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

export default function GoogleCustomerReviewsOptIn({ order }) {
  useEffect(() => {
    const email = order?.user?.email || order?.guestEmail;
    if (!order?.orderNumber || !email) return undefined;

    const key = `${order.orderNumber}:${email}`;
    if (window.__rfxGcrOptIn === key) return undefined;

    const render = () => {
      if (!window.gapi?.load) return;
      window.gapi.load("surveyoptin", () => {
        if (!window.gapi.surveyoptin?.render || window.__rfxGcrOptIn === key) return;
        window.gapi.surveyoptin.render({
          merchant_id: MERCHANT_ID,
          order_id: order.orderNumber,
          email,
          delivery_country: order.shippingAddress?.country || "CA",
          estimated_delivery_date: dateOnly(order.estimatedDelivery, order.createdAt),
          opt_in_style: "CENTER_DIALOG",
        });
        window.__rfxGcrOptIn = key;
      });
    };

    window.renderOptIn = render;
    const existing = document.getElementById("google-customer-reviews-script");
    if (existing) render();
    else {
      const script = document.createElement("script");
      script.id = "google-customer-reviews-script";
      script.src = "https://apis.google.com/js/platform.js?onload=renderOptIn";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
    return () => {
      if (window.renderOptIn === render) delete window.renderOptIn;
    };
  }, [order]);

  return null;
}
