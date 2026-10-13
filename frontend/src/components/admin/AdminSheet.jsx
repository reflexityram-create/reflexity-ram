import { useEffect, useRef } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { pushBackHandler } from '@/lib/appBridge';

const FOCUSABLE = 'button, select, input, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';

// The panel the admin pages open over a list (an order, a product). On a phone it is a full screen with its own header and a
// back arrow; from the tablet width up it is the centred dialog it always was. Escape, the backdrop and the phone app's Back
// button close it; focus stays inside while it is open and returns to where it was.
export default function AdminSheet({ titleId, title, subtitle, badges, onClose, closeLabel = 'Close', children, wide = false }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector(FOCUSABLE)?.focus(), 0);
    const onKey = (event) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    const dropBack = pushBackHandler(onClose);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      dropBack();
      document.body.style.overflow = previousOverflow;
      trigger?.focus?.();
    };
    // onClose changes every render of the parent; the sheet must not re-run its setup (and steal focus) each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 md:flex md:items-start md:justify-center md:p-4 md:overflow-auto" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
      <div className="absolute inset-0 hidden bg-black/80 backdrop-blur-sm md:block" onClick={onClose} aria-hidden="true" />
      <div className={`sheet-panel relative z-10 flex h-full flex-col md:my-8 md:block md:h-auto md:w-full md:p-6 ${wide ? 'md:max-w-3xl' : 'md:max-w-2xl'}`}>
        <header className="sheet-header flex shrink-0 items-center gap-1 border-b px-2 py-2 md:mb-6 md:gap-3 md:border-0 md:p-0" style={{ borderColor: 'var(--border-strong)' }}>
          <button type="button" aria-label={closeLabel} onClick={onClose} className="order-first flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-neutral-400 hover:bg-white/5 hover:text-white md:order-last md:h-9 md:w-9">
            <ArrowLeft size={20} className="md:hidden" />
            <X size={16} className="hidden md:block" />
          </button>
          <div className="min-w-0 flex-1 px-1 md:px-0">
            <h2 id={titleId} className="truncate text-base font-bold md:text-lg">{title}</h2>
            {subtitle && <div className="mono truncate text-[12px] text-neutral-500">{subtitle}</div>}
            {badges && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{badges}</div>}
          </div>
        </header>
        <div className="sheet-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:overflow-visible md:p-0">{children}</div>
      </div>
    </div>
  );
}
