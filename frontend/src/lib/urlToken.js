// The one-time token in a password-reset or email-verification link. Links now carry it in the fragment (`#token=`), which
// the browser never sends to a server or the edge; links sent earlier have it in the query string, so both are read. Once
// read, it is taken out of the address bar and the history entry (the way ReviewOrder and AuthCallback treat theirs).
export function readUrlToken(location = window.location) {
  const fromFragment = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  return fromFragment || new URLSearchParams(location.search).get("token") || null;
}

export function clearUrlToken(location = window.location, history = window.history) {
  if (!location.search && !location.hash) return;
  history.replaceState(history.state, "", location.pathname);
}
