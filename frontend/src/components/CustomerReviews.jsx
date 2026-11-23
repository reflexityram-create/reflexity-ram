import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { ratingLabel, reviewCountLabel, reviewDate } from "@/lib/reviews";

export function Stars({ rating, size = 14 }) {
  const filled = Math.round(rating);
  return (
    <span className="inline-flex text-amber-500" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} fill={n <= filled ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

// One line under a heading: stars, average and count. Rendered as a link or a
// button by the caller so it can jump to the full list.
export function RatingSummary({ summary, size = 14 }) {
  if (!summary?.count) return null;
  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={`Rated ${summary.average} out of 5 from ${reviewCountLabel(summary.count)}`}
    >
      <Stars rating={summary.average} size={size} />
      <span className="text-[13px] font-medium" aria-hidden="true">{ratingLabel(summary)}</span>
    </span>
  );
}

function ReviewCard({ review }) {
  return (
    <article className="glass-soft rounded-xl p-5 flex flex-col" data-testid="store-review">
      <div className="flex items-center justify-between gap-3">
        <Stars rating={review.rating} />
        <time className="mono text-[11px]" style={{ color: "var(--fg-faint)" }} dateTime={review.createdAt}>
          {reviewDate(review.createdAt)}
        </time>
      </div>
      {review.title && <h3 className="font-semibold text-[15px] mt-3">{review.title}</h3>}
      <p className="text-[14px] leading-relaxed mt-2 whitespace-pre-line" style={{ color: "var(--fg-muted)" }}>
        {review.body}
      </p>
      <div className="mt-auto pt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: "var(--fg-muted)" }}>
        <span className="font-medium" style={{ color: "var(--fg)" }}>{review.displayName}</span>
        {review.verifiedPurchase && <span className="text-emerald-600 dark:text-emerald-500">Verified purchase</span>}
        {review.product?.name && (
          <>
            <span aria-hidden="true">·</span>
            {review.product.slug ? (
              <Link to={`/shop/${review.product.slug}`} className="underline underline-offset-4">{review.product.name}</Link>
            ) : (
              <span>{review.product.name}</span>
            )}
          </>
        )}
      </div>
    </article>
  );
}

// Home page section: overall store rating beside the newest reviews.
// Renders nothing until there is at least one approved review.
export function StoreReviewsSection({ data, number = "03" }) {
  const { summary, reviews } = data;
  if (!summary.count || !reviews.length) return null;
  return (
    <section id="reviews" className="mt-14 scroll-mt-20" aria-labelledby="home-reviews" data-testid="home-reviews">
      <div className="section-label mb-2"><span className="num">{number}</span> CUSTOMER REVIEWS</div>
      <h2 id="home-reviews" className="text-xl sm:text-2xl font-semibold tracking-tight mb-5">What buyers say</h2>
      <div className="grid gap-3 sm:gap-5 lg:grid-cols-[260px_1fr]">
        <div className="glass rounded-xl p-5 h-fit">
          <div className="text-4xl font-bold tracking-tight">{Number(summary.average).toFixed(1)}</div>
          <div className="mt-2"><Stars rating={summary.average} size={18} /></div>
          <div className="mt-2 text-[13px]" style={{ color: "var(--fg-muted)" }}>{reviewCountLabel(summary.count)}</div>
          <p className="mt-4 text-[12px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            Only buyers with a paid, shipped order can review, and low ratings are published too.
          </p>
        </div>
        <div className={`grid gap-3 sm:gap-5 ${reviews.length > 1 ? "md:grid-cols-2" : ""}`}>
          {reviews.map((review) => (
            <ReviewCard key={review._id || `${review.createdAt}-${review.displayName}`} review={review} />
          ))}
        </div>
      </div>
    </section>
  );
}
