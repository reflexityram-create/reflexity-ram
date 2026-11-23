// Small, framework-free helpers shared by the home page and product page
// review displays (kept here so node tests can check them without React).

export const EMPTY_REVIEWS = Object.freeze({ reviews: [], summary: { count: 0, average: 0 } });

export function reviewCountLabel(count) {
  return `${count} verified review${count === 1 ? "" : "s"}`;
}

export function ratingLabel(summary) {
  if (!summary?.count) return "";
  return `${Number(summary.average).toFixed(1)} · ${reviewCountLabel(summary.count)}`;
}

export function reviewDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

// Accept only the shape the API promises; anything else shows no reviews
// rather than a broken section.
export function normalizeStoreReviews(data) {
  const count = Number(data?.summary?.count);
  const average = Number(data?.summary?.average);
  if (!Array.isArray(data?.reviews) || !Number.isFinite(count) || count <= 0 || !Number.isFinite(average)) {
    return EMPTY_REVIEWS;
  }
  return { summary: { count, average }, reviews: data.reviews.filter((r) => r && r.body && r.rating) };
}
