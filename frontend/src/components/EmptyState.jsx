import { Link } from "react-router-dom";

export default function EmptyState({ icon: Icon, title, description, ctaLabel, ctaTo, secondaryLabel, secondaryTo, testId = "empty-state", as: Heading = "h3" }) {
  return (
    <div
      className="glass rounded-2xl p-12 text-center flex flex-col items-center"
      data-testid={testId}
    >
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/5 flex items-center justify-center mb-5">
          <Icon size={26} className="text-neutral-400" />
        </div>
      )}
      <Heading className="text-xl font-semibold tracking-tight mb-2">{title}</Heading>
      {description && (
        <p className="text-[14px] text-neutral-400 max-w-md mb-6 leading-relaxed">
          {description}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {ctaLabel && ctaTo && (
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
