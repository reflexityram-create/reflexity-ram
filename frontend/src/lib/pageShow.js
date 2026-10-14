// Runs `callback` when the browser shows this page again from its back/forward cache (the page comes back exactly as it was left,
// JavaScript state included, and no new load happens), and returns the function that stops listening. Used on the checkout page, which
// leaves for Stripe by assigning location: pressing Back must not bring back a button still saying "Opening secure checkout…".
// `target` is the window; tests pass their own EventTarget.
// How long the hand-off to Stripe may take before the button comes back. A navigation that never completes (the buyer pressed Stop, a
// filter blocks Stripe, the connection dropped) leaves this page in place and fires no "shown again" event, so without this the button
// would stay on "Opening secure checkout…" until a reload.
export const HANDOFF_PATIENCE_MS = 20_000;

export function onRestoredFromCache(callback, target = typeof window === 'undefined' ? undefined : window) {
  if (!target) return () => {};
  const handler = (event) => { if (event.persisted === true) callback(); };
  target.addEventListener('pageshow', handler);
  return () => target.removeEventListener('pageshow', handler);
}
