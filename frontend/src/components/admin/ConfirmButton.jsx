import { useState } from 'react';
import { Loader2 } from 'lucide-react';

// A button that asks "are you sure?" in the page itself. A browser confirm dialog does not show inside the phone app's
// web view unless the app implements it, so a button that depended on one would silently do nothing there.
//   idle:    [ label ]
//   asking:  message, [ Yes, confirmLabel ] [ Go back ]
export default function ConfirmButton({
  label, confirmLabel, message, onConfirm, disabled = false, busy = false, variant = 'primary', testId, className = '',
}) {
  const [asking, setAsking] = useState(false);
  const kind = variant === 'danger' ? 'btn-danger' : variant === 'secondary' ? 'btn-secondary' : 'btn-primary';

  if (!asking) {
    return (
      <button type="button" className={`${kind} min-h-11 ${className}`} disabled={disabled || busy} onClick={() => setAsking(true)} data-testid={testId}>
        {busy && <Loader2 size={14} className="animate-spin" />}
        {label}
      </button>
    );
  }
  const confirm = async () => {
    try { await onConfirm(); } finally { setAsking(false); }
  };
  return (
    <div role="group" aria-label={label} className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--glass-bg-soft)' }} data-testid={testId ? `${testId}-asking` : undefined}>
      {message && <p className="text-[13px] leading-relaxed" role="alert">{message}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={`${kind} min-h-11 flex-1`} onClick={confirm} disabled={busy} data-testid={testId ? `${testId}-yes` : undefined}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {confirmLabel || `Yes, ${label.toLowerCase()}`}
        </button>
        <button type="button" className="btn-secondary min-h-11 flex-1" onClick={() => setAsking(false)} disabled={busy}>Go back</button>
      </div>
    </div>
  );
}
