// Small pure helpers for the "Phone app" panel on the admin Security page (components/admin/PhoneAppPanel.jsx).

// "5 min ago", "yesterday" ... for when a paired phone last asked the server for news. A phone that is on keeps
// asking every half minute, so anything older than a few minutes means it is off, offline or the app was stopped.
export function lastSeenLabel(value, now = Date.now()) {
  if (!value) return 'never connected';
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (Number.isNaN(seconds)) return 'unknown';
  if (seconds < 90) return 'connected now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// A phone is "live" when it asked within the last few minutes; the panel uses it to colour the dot.
export const isLive = (value, now = Date.now()) => Boolean(value) && now - new Date(value).getTime() < 3 * 60 * 1000;

// "m:ss" left on a pairing code, or null once it has expired.
export function codeCountdown(expiresAt, now = Date.now()) {
  const left = Math.floor((new Date(expiresAt).getTime() - now) / 1000);
  if (!Number.isFinite(left) || left <= 0) return null;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
