import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export default function ImageModal({ open, images, startIndex = 0, onClose, alt }) {
  const imageCount = Array.isArray(images) ? images.length : 0;
  const [idx, setIdx] = useState(startIndex);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    setIdx(startIndex);
  }, [startIndex, open]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => dialogRef.current?.querySelector('button')?.focus(), 0);
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (imageCount > 1 && e.key === "ArrowRight") setIdx((i) => (i + 1) % imageCount);
      if (imageCount > 1 && e.key === "ArrowLeft") setIdx((i) => (i - 1 + imageCount) % imageCount);
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll('button')];
        if (focusable.length && ((e.shiftKey && document.activeElement === focusable[0]) || (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]))) {
          e.preventDefault();
          (e.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      triggerRef.current?.focus?.();
    };
  }, [open, images, imageCount, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="image-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Product image viewer"
      ref={dialogRef}
    >
      <button
        className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"
        onClick={onClose}
        data-testid="image-modal-close"
        aria-label="Close image viewer"
      >
        <X size={18} />
      </button>

      {imageCount > 1 && (
        <button
          className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"
          onClick={(e) => {
            e.stopPropagation();
            setIdx((i) => (i - 1 + imageCount) % imageCount);
          }}
          data-testid="image-modal-prev"
          aria-label="Previous image"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      {imageCount > 0 ? (
        <img
          src={images[idx]}
          alt={alt}
          className="max-h-[88vh] max-w-[92vw] object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
          data-testid="image-modal-image"
        />
      ) : (
        <p className="text-sm text-neutral-400" data-testid="image-modal-empty">No image available.</p>
      )}

      {imageCount > 1 && (
        <button
          className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"
          onClick={(e) => {
            e.stopPropagation();
            setIdx((i) => (i + 1) % imageCount);
          }}
          data-testid="image-modal-next"
          aria-label="Next image"
        >
          <ChevronRight size={20} />
        </button>
      )}

      <div className="absolute bottom-6 left-0 right-0 flex justify-center mono text-[11px] text-neutral-400">
        {imageCount > 0 ? `${idx + 1} / ${imageCount}` : "No images"}
      </div>
    </div>
  );
}
