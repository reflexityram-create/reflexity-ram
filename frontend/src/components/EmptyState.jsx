import { Link } from "react-router-dom";

// `onCta` makes the main action a button (a retry) instead of a link: a link to the page the buyer is already on does nothing.
// `eyebrow` adds a small mono label above the title; `className` lets a page size the box (e.g. fill a column).
export default function EmptyState({ icon: Icon, title, description, ctaLabel, ctaTo, onCta, secondaryLabel, secondaryTo, testId = "empty-state", as: Heading = "h3", eyebrow = null, className = "", role }) {
  return (
    <div
      className={`glass rounded-2xl p-12 text-center flex flex-col items-center ${className}`.trim()}
      data-testid={testId}
      role={role}
    >
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/5 flex items-center justify-center mb-5">
          <Icon size={26} className="text-neutral-400" />
        </div>
      )}
      {eyebrow && <div className="mono text-[10px] text-neutral-500 tracking-widest mb-2">{eyebrow}</div>}
      <Heading className="text-xl font-semibold tracking-tight mb-2">{title}</Heading>
      {description && (
        <p className={`text-[14px] text-neutral-400 max-w-md leading-relaxed${ctaLabel || secondaryLabel ? " mb-6" : ""}`}>
          {description}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {ctaLabel && onCta && (
          <button type="button" onClick={onCta} className="btn-primary" data-testid={`${testId}-cta`}>
            {ctaLabel}
          </button>
        )}
        {ctaLabel && ctaTo && !onCta && (
          <Link to={ctaTo} className="btn-primary" data-testid={`${testId}-cta`}>
            {ctaLabel}
          </Link>
        )}
        {secondaryLabel && secondaryTo && (
          <Link to={secondaryTo} className="btn-secondary" data-testid={`${testId}-secondary`}>
            {secondaryLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
