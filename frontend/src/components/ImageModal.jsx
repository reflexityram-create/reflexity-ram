import { useEffect, useRef, useState } from "react";
import { viewerImageUrl } from "@/lib/imageUrl";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export default function ImageModal({ open, images, startIndex = 0, onClose, alt }) {
  const imageCount = Array.isArray(images) ? images.length : 0;
  const [idx, setIdx] = useState(startIndex);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const viewportRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const resetView = () => {
    pointers.current.clear();
    gesture.current = null;
    setView({ scale: 1, x: 0, y: 0 });
  };
  const bounded = (next) => {
    const box = viewportRef.current?.getBoundingClientRect();
    const scale = Math.max(1, Math.min(5, next.scale));
    const picture = viewportRef.current?.querySelector('img');
    const maxX = Math.max(0, ((picture?.clientWidth || 0) * scale - (box?.width || 0)) / 2);
    const maxY = Math.max(0, ((picture?.clientHeight || 0) * scale - (box?.height || 0)) / 2);
    return { scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  };
  const zoom = (factor) => setView((v) => bounded({ ...v, scale: v.scale * factor }));
  const beginGesture = () => {
    const points = [...pointers.current.values()];
    gesture.current = points.length > 1
      ? { view, distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) }
      : { view, point: points[0] };
  };
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture();
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...pointers.current.values()];
    const initial = gesture.current;
    if (points.length > 1 && initial.distance > 0) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      setView(bounded({ ...initial.view, scale: initial.view.scale * distance / initial.distance }));
    } else if (initial.point) {
      setView(bounded({ ...initial.view, x: initial.view.x + e.clientX - initial.point.x, y: initial.view.y + e.clientY - initial.point.y }));
    }
  };
  const endPointer = (e) => {
    pointers.current.delete(e.pointerId);
    beginGesture();
  };
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    setIdx(startIndex);
  }, [startIndex, open]);

  useEffect(resetView, [idx, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    triggerRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector('button')?.focus(), 0);
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current();
      if (imageCount > 1 && e.key === "ArrowRight") setIdx((i) => (i + 1) % imageCount);
      if (imageCount > 1 && e.key === "ArrowLeft") setIdx((i) => (i - 1 + imageCount) % imageCount);
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
        if (focusable.length && ((e.shiftKey && document.activeElement === focusable[0]) || (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]))) {
          e.preventDefault();
          (e.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      triggerRef.current?.focus?.();
    };
  }, [open, imageCount]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 overscroll-contain"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="image-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Product image viewer"
      ref={dialogRef}
    >
      <button
        className="absolute z-10 top-[max(1.25rem,env(safe-area-inset-top))] right-5 w-11 h-11 rounded-full bg-[#262626] hover:bg-[#404040] flex items-center justify-center text-[#ffffff]"
        onClick={onClose}
        data-testid="image-modal-close"
        aria-label="Close image viewer"
      >
        <X aria-hidden="true" size={18} />
      </button>

      {imageCount > 1 && (
        <button
          className="absolute z-10 left-4 md:left-8 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#262626] hover:bg-[#404040] flex items-center justify-center text-[#ffffff]"
          onClick={(e) => {
            e.stopPropagation();
            setIdx((i) => (i - 1 + imageCount) % imageCount);
          }}
          data-testid="image-modal-prev"
          aria-label="Previous image"
        >
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
      )}

      {imageCount > 0 ? (
        <div
          ref={viewportRef}
          className="w-full h-[72dvh] overflow-hidden flex items-center justify-center"
          style={{ touchAction: 'none', cursor: view.scale > 1 ? 'grab' : 'zoom-in' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          onDoubleClick={() => view.scale > 1 ? resetView() : zoom(2.5)}
          onClick={(e) => e.stopPropagation()}
          data-testid="image-modal-viewport"
        >
          <img
            src={viewerImageUrl(images[idx])}
            alt={alt}
            className="h-auto w-auto max-h-full max-w-full object-contain select-none"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: 'center' }}
            width="2400"
            height="1800"
            draggable={false}
            data-testid="image-modal-image"
          />
        </div>
      ) : (
        <p className="text-sm text-[#a3a3a3]" data-testid="image-modal-empty">No image available.</p>
      )}

      {imageCount > 1 && (
        <button
          className="absolute z-10 right-4 md:right-8 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#262626] hover:bg-[#404040] flex items-center justify-center text-[#ffffff]"
          onClick={(e) => {
            e.stopPropagation();
            setIdx((i) => (i + 1) % imageCount);
          }}
          data-testid="image-modal-next"
          aria-label="Next image"
        >
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      )}

      {imageCount > 0 && (
        <div className="absolute z-10 top-[max(1.25rem,env(safe-area-inset-top))] left-4 flex items-center gap-1 rounded-full bg-[#262626] p-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => zoom(1 / 1.5)} className="w-11 h-11 rounded-full text-[#ffffff] flex items-center justify-center hover:bg-[#404040] disabled:opacity-40"><ZoomOut aria-hidden="true" size={20} /></button>
          <span className="text-[#ffffff] text-xs tabular-nums min-w-10 text-center" aria-live="polite">{Math.round(view.scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" disabled={view.scale >= 5} onClick={() => zoom(1.5)} className="w-11 h-11 rounded-full text-[#ffffff] flex items-center justify-center hover:bg-[#404040] disabled:opacity-40"><ZoomIn aria-hidden="true" size={20} /></button>
          <button type="button" aria-label="Reset zoom" onClick={resetView} className="w-11 h-11 rounded-full text-[#ffffff] flex items-center justify-center hover:bg-[#404040]"><RotateCcw aria-hidden="true" size={18} /></button>
        </div>
      )}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center mono text-[11px] text-[#a3a3a3]">
        {imageCount > 0 ? `${idx + 1} / ${imageCount}` : "No images"}
      </div>
    </div>
  );
}
