// The phone's appearance. A browser with no matchMedia, one that throws, or a MediaQueryList that only has addListener (Safari before 14)
// must not take the whole storefront down: an unreadable preference resolves to light, the site's long-standing default.
const DARK_QUERY = "(prefers-color-scheme: dark)";

function darkQuery() {
  try {
    return typeof globalThis.window?.matchMedia === "function" ? globalThis.window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

export const systemTheme = () => (darkQuery()?.matches ? "dark" : "light");

export function subscribeSystemTheme(notify) {
  const media = darkQuery();
  if (media && typeof media.addEventListener === "function") {
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }
  if (media && typeof media.addListener === "function") {
    media.addListener(notify);
    return () => media.removeListener(notify);
  }
  return () => {};
}
