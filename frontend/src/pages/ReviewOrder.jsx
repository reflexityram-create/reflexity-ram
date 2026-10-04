import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { reviewLinkApi } from "@/lib/api";
import { imageUrl } from "@/lib/imageUrl";
import { useSEO } from "@/lib/seo";

const TOKEN_KEY = "rfx_review_link";

// The emailed link carries its token in the URL fragment, which never reaches
// a server. It then lives only in this browser session so a refresh still works.
function readReviewLink() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  let token = params.get("t");
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else token = window.sessionStorage.getItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
  return { token, unsubscribe: params.get("unsubscribe") === "1" };
}

function Stars({ value, size = 16 }) {
  return (
    <div className="flex text-amber-500" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} fill={n <= value ? "currentColor" : "none"} />)}
    </div>
  );
}

function ItemReviewForm({ token, item, onPublished }) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await reviewLinkApi.submit(token, { slug: item.slug, rating, title, body });
      onPublished(item.slug, data.review);
      toast.success("Review published", { description: "Thanks for helping other buyers" });
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not submit review");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="flex items-center gap-1" aria-label="Choose rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} aria-pressed={n === rating} className="p-1 text-amber-500 hover:scale-110 transition-transform">
            <Star size={19} fill={n <= rating ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Review title (optional)" maxLength={120} />
      <textarea className="input min-h-28 resize-y" value={body} onChange={(e) => setBody(e.target.value)} placeholder="How did it work for your system?" minLength={10} maxLength={2000} required />
      <button className="btn-primary w-full sm:w-auto" disabled={submitting}>{submitting ? "Publishing..." : "Publish review"}</button>
    </form>
  );
}

export default function ReviewOrder() {
  useSEO({ title: "Review your order", description: "Leave a verified review of the memory you bought from Reflexity RAM.", noindex: true });
  const [link] = useState(readReviewLink);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [unsubscribing, setUnsubscribing] = useState(false);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState({}, "", window.location.pathname);
    if (!link.token) {
      setError("This page needs the review link from your email.");
      return;
    }
    reviewLinkApi.lookup(link.token)
      .then(({ data: next }) => setData(next))
      .catch((err) => setError(err.response?.data?.error || "We couldn't load this order. Try the link again in a minute."));
  }, [link.token]);

  const published = (slug, review) => setData((current) => ({
    ...current,
    items: current.items.map((item) => (item.slug === slug ? { ...item, review } : item)),
  }));

  const unsubscribe = async () => {
    setUnsubscribing(true);
    try {
      await reviewLinkApi.unsubscribe(link.token);
      setData((current) => ({ ...current, unsubscribed: true }));
      toast.success("Unsubscribed from review emails");
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not unsubscribe");
    } finally {
      setUnsubscribing(false);
    }
  };

  return (
    <>
      <Header />
      <main className="container-tight pt-32 pb-20 min-h-screen" data-testid="review-order-page">
        <div className="max-w-2xl mx-auto">
          {error ? (
            <div className="glass rounded-2xl p-8 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Review link not available</p>
                <p className="text-[13px] text-neutral-400 mt-1">{error}</p>
                <p className="text-[13px] text-neutral-400 mt-3">
                  If you ordered with an account, you can <Link to="/account" className="underline">sign in</Link> and review from the product page.
                  Otherwise email <a href="mailto:reflexityram@gmail.com" className="underline">reflexityram@gmail.com</a> and we'll send a new link.
                </p>
              </div>
            </div>
          ) : !data ? (
            <div className="flex items-center gap-2 text-neutral-400 py-12">
              <Loader2 size={16} className="animate-spin" />
              Loading your order…
            </div>
          ) : (
            <>
              {link.unsubscribe && !data.unsubscribed && (
                <section className="glass rounded-2xl p-6 mb-8">
                  <h2 className="font-semibold text-[16px]">Stop review emails?</h2>
                  <p className="text-[13px] text-neutral-400 mt-1">
                    We'll stop sending review requests to {data.emailHint || "this address"}. Order and shipping emails still arrive.
                  </p>
                  <button type="button" className="btn-primary mt-4" onClick={unsubscribe} disabled={unsubscribing}>
                    {unsubscribing ? "Unsubscribing..." : "Unsubscribe"}
                  </button>
                </section>
              )}
              {data.unsubscribed && (
                <div className="glass-soft rounded-xl p-4 mb-8 flex items-center gap-2 text-[13px]" role="status">
                  <CheckCircle size={15} className="text-emerald-500 shrink-0" />
                  You're unsubscribed from review emails{data.emailHint ? ` at ${data.emailHint}` : ""}. You can still leave a review below.
                </div>
              )}

              <div className="section-label mb-3"><span className="num">REVIEWS</span> VERIFIED PURCHASE</div>
              <h1 className="text-3xl font-bold tracking-tight">How did it go{data.order.firstName ? `, ${data.order.firstName}` : ""}?</h1>
              <p className="text-[14px] text-neutral-400 mt-2">
                Order <span className="mono">{data.order.orderNumber}</span>. Your review appears on the product page with your first name and a "Verified purchase" label. Low ratings are published too.
              </p>

              {!data.eligible ? (
                <div className="glass rounded-2xl p-6 mt-8 text-[14px] text-neutral-400">
                  This order can't be reviewed. Reviews open once a paid order ships; refunded or cancelled orders can't be reviewed.
                </div>
              ) : (
                <div className="mt-8 space-y-4">
                  {data.items.map((item) => (
                    <article key={item.slug} className="glass rounded-2xl p-5">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5 shrink-0">
                          {item.image && <img src={imageUrl(item.image)} alt="" className="w-full h-full object-cover" />}
                        </div>
                        <h2 className="font-semibold text-[15px] leading-snug">{item.name}</h2>
                      </div>
                      {item.review ? (
                        <div className="mt-4 glass-soft rounded-xl p-4">
                          <div className="flex items-center justify-between gap-3">
                            <Stars value={item.review.rating} size={14} />
                            <span className="text-[11px] text-emerald-500">Published</span>
                          </div>
                          {item.review.title && <h3 className="font-semibold text-[14px] mt-2">{item.review.title}</h3>}
                          <p className="text-[13px] leading-relaxed mt-1 text-neutral-400">{item.review.body}</p>
                          <Link to={`/shop/${item.slug}`} className="text-[12px] underline mt-3 inline-block">See it on the product page</Link>
                        </div>
                      ) : item.reviewable ? (
                        <ItemReviewForm token={link.token} item={item} onPublished={published} />
                      ) : (
                        <p className="text-[13px] text-neutral-500 mt-3">This product is no longer listed, so it can't be reviewed.</p>
                      )}
                    </article>
                  ))}
                </div>
              )}

              <p className="text-[12px] text-neutral-500 mt-10 leading-relaxed">
                Questions about the order? Email <a href="mailto:reflexityram@gmail.com" className="underline">reflexityram@gmail.com</a>. See our <Link to="/privacy" className="underline">privacy policy</Link> for how reviews are shown.
                {!data.unsubscribed && !link.unsubscribe && (
                  <> Don't want review emails? <button type="button" className="underline" onClick={unsubscribe} disabled={unsubscribing}>Unsubscribe</button>.</>
                )}
              </p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
