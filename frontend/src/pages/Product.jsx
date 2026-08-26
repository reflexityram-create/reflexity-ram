import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  Minus,
  Plus,
  ShoppingCart,
  Truck,
  Shield,
  Copy,
  Check,
  AlertTriangle,
  Package,
  Cpu,
  Star,
} from "lucide-react";
import { Pencil, Globe } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ImageModal from "@/components/ImageModal";
import ProductCard from "@/components/ProductCard";
import { imageUrl } from "@/lib/imageUrl";
import EmptyState from "@/components/EmptyState";
import { useCart, useRecentlyViewed } from "@/lib/store";
import useAuthStore from "@/lib/authStore";
import { useSEO } from "@/lib/seo";
import { productsApi } from "@/lib/api";
import { reviewsApi } from "@/lib/api";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import {
  formatStorePrice,
  formatStorePriceWithCode,
  STANDARD_SHIPPING_PRICE,
  STORE_CURRENCY_CODE,
} from "@/lib/currency";


const TABS = [
  { id: "specs", label: "Specifications" },
  { id: "compat", label: "Compatibility" },
  { id: "shipping", label: "Shipping" },
  { id: "warranty", label: "Warranty" },
  { id: "reviews", label: "Reviews" },
];

export default function Product() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [p, setP] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [tab, setTab] = useState("specs");
  const [modalOpen, setModalOpen] = useState(false);
  const [skuCopied, setSkuCopied] = useState(false);
  const [reviewData, setReviewData] = useState({ reviews: [], summary: { count: 0, average: 0 } });

  const addItem = useCart((s) => s.addItem);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const addViewed = useRecentlyViewed((s) => s.add);
  const recentSlugs = useRecentlyViewed((s) => s.slugs);

  useSEO({
    title: p?.metaTitle || p?.name,
    description: p
      ? p.metaDescription || `${p.name} — ${p.generation} ${p.formFactor} · ${p.speedLabel} · ${p.cas} · ${p.condition}. Tested RAM with ${p.warranty} warranty, shipping from Toronto across Canada and the US.`
      : null,
  });

  // Fetch product from API on every slug change — always fresh data
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setNotFound(false);
    setP(null);
    setImgIdx(0);
    productsApi.getBySlug(slug, { signal: controller.signal })
      .then(({ data }) => {
        if (!active) return;
        const product = data?.product;
        if (!product) { setNotFound(true); return; }
        setP(product);
        if (product) addViewed(product.slug);
        // Fetch related products (same generation, excluding this one)
        productsApi.list({ generation: product.generation, limit: 4 }, { signal: controller.signal })
          .then(({ data: d }) => {
            if (!active) return;
            setRelated((d.products || []).filter((x) => x.slug !== product.slug).slice(0, 3));
          })
          .catch((error) => { if (active && error?.code !== 'ERR_CANCELED') return; });
      })
      .catch((error) => { if (active && error?.code !== 'ERR_CANCELED') setNotFound(true); })
      .finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [slug]);

  useEffect(() => {
    if (!p?.slug) return;
    const controller = new AbortController();
    let active = true;
    reviewsApi.list(p.slug, { signal: controller.signal }).then(({ data }) => {
      if (active) setReviewData(data);
    }).catch(() => {});
    return () => { active = false; controller.abort(); };
  }, [p?.slug]);

  const recentlyViewed = useMemo(() => {
    return recentSlugs
      .filter((s) => s !== slug)
      .slice(0, 4);
  }, [recentSlugs, slug]);

  // JSON-LD structured data for Google rich results
  const jsonLd = useMemo(() => {
    if (!p) return null;
    const manufacturer = p.brand || (/^sk[ -]?hynix\b/i.test(p.name) ? "SK hynix" : p.name.split(" ")[0]);
    const data = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      image: (p.images || []).map(imageUrl).filter(Boolean),
      description: p.description || `${p.name} — ${p.generation} ${p.formFactor} ${p.speedLabel} ${p.cas} ${p.condition}. ${p.warranty} warranty.`,
      sku: p.sku,
      brand: { "@type": "Brand", name: manufacturer },
      offers: {
        "@type": "Offer",
        url: `https://reflexityram.com/shop/${p.slug}`,
        priceCurrency: STORE_CURRENCY_CODE,
        price: p.price,
        priceValidUntil: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
        itemCondition: p.condition === "New" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
        availability: p.stock === "out"
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
        seller: { "@type": "Organization", name: "Reflexity RAM" },
      },
      additionalProperty: [
        { "@type": "PropertyValue", name: "Generation", value: p.generation },
        { "@type": "PropertyValue", name: "Form Factor", value: p.formFactor },
        { "@type": "PropertyValue", name: "Capacity", value: p.capacityLabel },
        { "@type": "PropertyValue", name: "Speed", value: p.speedLabel },
        { "@type": "PropertyValue", name: "CAS Latency", value: p.cas },
        { "@type": "PropertyValue", name: "ECC", value: p.ecc ? "Yes" : "No" },
      ].filter((v) => v.value),
    };
    if (p.mpn) data.mpn = p.mpn;
    if (reviewData.summary.count > 0) {
      data.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: reviewData.summary.average,
        reviewCount: reviewData.summary.count,
        bestRating: 5,
        worstRating: 1,
      };
    }
    return data;
  }, [p, reviewData.summary]);

  if (loading) {
    return (
      <>
        <Header />
        <main className="page" data-testid="product-loading">
          <div className="container-tight pt-16">
            <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14">
              <div className="skeleton aspect-[5/4] rounded-2xl" />
              <div className="space-y-4 pt-4">
                <div className="skeleton h-3 w-1/4" />
                <div className="skeleton h-8 w-3/4" />
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-12 w-1/3 mt-6" />
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (notFound || !p) {
    return (
      <>
        <Header />
        <main className="page" data-testid="product-not-found">
          <div className="container-tight pt-16">
            <EmptyState
              icon={Package}
              title="Module not found"
              description="That SKU isn't in our catalog. Browse all memory or contact us with the part number you need."
              ctaLabel="Back to shop"
              ctaTo="/shop"
              secondaryLabel="Email us"
              secondaryTo="/support"
            />
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const addToCart = async () => {
    const result = await addItem(p.slug, qty);
    if (result && !result.success) {
      toast.error(result.message || "Failed to add to cart");
      return;
    }
    toast.success("Added to cart", {
      description: `${qty} × ${p.name}`,
      icon: <Check size={16} className="text-emerald-400" />,
    });
  };

  const buyNow = async () => {
    const result = await addItem(p.slug, qty);
    if (result && !result.success) {
      toast.error(result.message || "Failed to add to cart");
      return;
    }
    navigate("/checkout");
  };

  const copySku = async () => {
    try {
      await navigator.clipboard.writeText(p.sku);
    } catch {
      /* noop */
    }
    setSkuCopied(true);
    toast.success("SKU copied", { description: p.sku });
    setTimeout(() => setSkuCopied(false), 1800);
  };

  // Normalised image URLs for gallery
  const imageUrls = (p.images || []).map(imageUrl).filter(Boolean);

  return (
    <>
      <Header />
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      <main className="page pb-32 md:pb-16" data-testid="product-page">
        <div className="container-tight pt-8">
          <Link
            to="/shop"
            className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-white mb-6"
            data-testid="product-back-link"
          >
            <ChevronLeft size={14} /> Back to shop
          </Link>

          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14">
            {/* Gallery */}
            <div>
              <button
                className="block w-full glass rounded-2xl overflow-hidden aspect-[5/4] mb-3 cursor-zoom-in"
                onClick={() => setModalOpen(true)}
                data-testid="product-main-image-btn"
              >
                {imageUrls[imgIdx] ? (
                  <img
                    src={imageUrls[imgIdx]}
                    alt={p.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Cpu size={48} className="text-neutral-700" />
                  </div>
                )}
              </button>
              {imageUrls.length > 1 && (
                <div className="grid grid-cols-4 gap-2" data-testid="product-thumbnails">
                  {imageUrls.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setImgIdx(i)}
                      data-active={i === imgIdx}
                      className={`aspect-square rounded-lg overflow-hidden border ${
                        i === imgIdx ? "border-white/40" : "border-white/5 hover:border-white/20"
                      }`}
                      data-testid={`product-thumbnail-${i}`}
                    >
                      <img src={src} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right column */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="mono text-[11px] text-neutral-500 tracking-widest">{p.sku}</span>
                <button
                  onClick={copySku}
                  className="btn-ghost text-[11px]"
                  data-testid="product-copy-sku-btn"
                >
                  {skuCopied ? <Check size={11} /> : <Copy size={11} />}
                  {skuCopied ? "Copied" : "Copy"}
                </button>
              </div>

              {isAdmin() && p._id && (
                <Link
                  to={`/admin/products?edit=${p._id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors text-[12px] font-medium"
                >
                  <Pencil size={11} /> Edit this product
                </Link>
              )}
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-3">
                {p.name}
              </h1>
              <div className="text-[13px] text-neutral-500 mb-5">{p.line}</div>

              <div className="flex flex-wrap gap-1.5 mb-6">
                <span className="pill">{p.generation}</span>
                <span className="pill">{p.formFactor}</span>
                <span className="pill">{p.capacityLabel}</span>
                <span className="pill">{p.speedLabel}</span>
                <span className="pill">{p.cas}</span>
                {p.ecc && <span className="pill pill-accent">ECC</span>}
              </div>

              <div className="flex items-end gap-3 mb-2">
                <div className="text-4xl font-bold tracking-tight">
                  {formatStorePrice(p.price)} <span className="text-sm font-medium text-neutral-500">{STORE_CURRENCY_CODE}</span>
                </div>
                {p.compareAt && p.compareAt > p.price && (
                  <div className="text-[13px] text-neutral-500 line-through mb-1.5">
                    {formatStorePrice(p.compareAt)}
                  </div>
                )}
                {p.compareAt && p.compareAt > p.price && (
                  <span className="pill pill-accent mb-1.5">
                    Save {formatStorePrice(p.compareAt - p.price, 0)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mb-6">
                <span
                  className={`pill ${
                    p.stock === "low" ? "pill-amber" : p.stock === "out" ? "" : "pill-accent"
                  }`}
                  data-testid="product-stock-pill"
                >
                  <span
                    className={`dot ${
                      p.stock === "low" ? "dot-amber" : p.stock === "out" ? "dot-red" : "dot-green"
                    }`}
                  />
                  {p.stockLabel}
                </span>
                <span className="mono text-[11px] text-neutral-500">
                  Dispatch: {p.estimatedDispatch}
                </span>
              </div>

              {/* Qty + add to cart */}
              <div className="flex flex-wrap items-stretch gap-3 mb-5">
                <div className="flex items-center glass rounded-full overflow-hidden" data-testid="product-qty-stepper">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="px-4 py-2.5 hover:bg-white/5"
                    data-testid="product-qty-decrease"
                  >
                    <Minus size={14} />
                  </button>
                  <div className="px-4 mono text-sm min-w-[2ch] text-center" data-testid="product-qty-value">
                    {qty}
                  </div>
                  <button
                    onClick={() => setQty((q) => q + 1)}
                    className="px-4 py-2.5 hover:bg-white/5"
                    data-testid="product-qty-increase"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <button
                  onClick={addToCart}
                  className="btn-primary flex-1 sm:flex-none"
                  data-testid="product-add-to-cart-btn"
                >
                  <ShoppingCart size={15} /> Add to cart
                </button>
                <button
                  onClick={buyNow}
                  className="btn-secondary flex-1 sm:flex-none"
                  data-testid="product-buy-now-btn"
                >
                  Buy now
                </button>
              </div>

              {/* Trust strip — quick reassurance at the point of decision */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4 text-[12px] text-neutral-600 dark:text-neutral-400">
                {["Individually tested", `${p.warranty} warranty`, "Ships from Toronto", "Secure checkout"].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <span className="text-emerald-600 dark:text-emerald-400">✓</span> {t}
                  </span>
                ))}
              </div>

              {/* Shipping + warranty */}
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                <div className="glass-soft rounded-xl p-4 flex items-start gap-3">
                  <Truck size={18} className="text-neutral-300 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-[13px] font-medium">🇨🇦 🇺🇸 Canada &amp; US shipping</div>
                    <div className="text-[12px] text-neutral-500">
                      {formatStorePriceWithCode(STANDARD_SHIPPING_PRICE, 0)} flat rate · ESD-safe · tracked
                    </div>
                  </div>
                </div>
                <div className="glass-soft rounded-xl p-4 flex items-start gap-3">
                  <Shield size={18} className="text-neutral-300 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-[13px] font-medium">{p.warranty}</div>
                    <div className="text-[12px] text-neutral-500">
                      Defect-replacement coverage
                    </div>
                  </div>
                </div>
              </div>

              {/* International orders pointer — framed as available, not blocked */}
              <div className="glass-soft rounded-xl p-4 flex items-start gap-3 mb-6">
                <Globe size={18} className="text-neutral-300 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[13px] font-medium">🌍 Shipping outside Canada &amp; US?</div>
                  <div className="text-[12px] text-neutral-500">
                    We ship worldwide as custom orders.{" "}
                    <Link to="/international" className="text-emerald-400 hover:text-emerald-300 underline">
                      Read more →
                    </Link>
                  </div>
                </div>
              </div>

              <div className="mono text-[10.5px] text-neutral-600 leading-relaxed mt-4">
                {p.note}
              </div>
            </div>
          </div>

          {/* TABS */}
          <div className="mt-16 border-t border-white/5 pt-10">
            <div className="flex flex-wrap gap-1 mb-6" data-testid="product-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="tab-pill"
                  data-active={tab === t.id}
                  data-testid={`product-tab-${t.id}`}
                >
                  {t.label}
                  {t.id === "reviews" && reviewData.summary.count > 0
                    ? ` (${reviewData.summary.count})`
                    : ""}
                </button>
              ))}
            </div>

            <div className="glass rounded-2xl p-6 md:p-8">
              {tab === "specs" && <SpecsTable p={p} />}
              {tab === "compat" && (
                <div data-testid="product-compat-content">
                  <ul className="space-y-2 text-[14px] text-neutral-300">
                    {(p.compatibility || []).map((c, i) => (
                      <li key={i} className="flex gap-2.5 leading-relaxed">
                        <span className="dot dot-green mt-2 shrink-0" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 flex gap-2 p-3.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-[12px] text-amber-200 leading-relaxed">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    Always check your motherboard's official QVL list before
                    purchasing high-speed DDR5 — compatibility is
                    board-and-CPU-dependent.
                  </div>

                  <h4 className="text-[12px] mono text-neutral-500 tracking-widest mt-6 mb-3">
                    WHAT'S INCLUDED
                  </h4>
                  <ul className="space-y-1.5 text-[13.5px] text-neutral-400">
                    {(p.included || []).map((item, k) => (
                      <li key={k} className="flex gap-2">
                        <span className="text-neutral-600">·</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {tab === "shipping" && (
                <div data-testid="product-shipping-content" className="space-y-3 text-[14px] text-neutral-300 leading-relaxed">
                  <p>Orders typically ship within 1–3 business days of purchase.</p>
                  <p>Memory modules are packaged appropriately to help protect them during transit. Packaging may include anti-static bags, original manufacturer packaging and boxes, or other suitable protective materials at our discretion.</p>
                  <p>
                    <Link to="/shipping" className="text-white underline underline-offset-4">
                      Full shipping policy →
                    </Link>
                  </p>
                </div>
              )}
              {tab === "warranty" && (
                <div data-testid="product-warranty-content" className="space-y-3 text-[14px] text-neutral-300 leading-relaxed">
                  <p>This SKU is covered by Reflexity's {p.warranty?.toLowerCase()} warranty against manufacturing defects.</p>
                  <p>DOA modules within 30 days are replaced no-questions.</p>
                  <p>
                    <Link to="/warranty" className="text-white underline underline-offset-4">
                      Full warranty terms →
                    </Link>
                  </p>
                </div>
              )}
              {tab === "reviews" && (
                <ReviewsSection product={p} data={reviewData} onUpdated={setReviewData} embedded />
              )}
            </div>
          </div>

          {/* Related */}
          {related.length > 0 && (
            <div className="mt-16">
              <div className="section-label mb-4">
                <span className="num">·</span> More {p.generation}
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="product-related">
                {related.map((r, i) => (
                  <ProductCard key={r.slug} p={r} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* Recently viewed — slugs only, fetch from API on demand */}
          {recentlyViewed.length > 0 && (
            <RecentlyViewedSection slugs={recentlyViewed} currentSlug={slug} />
          )}
        </div>

        {/* Sticky mobile buy bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-white/10 bg-black/85 backdrop-blur-xl px-4 py-3 flex items-center gap-3"
          data-testid="mobile-buy-bar"
        >
          <div className="flex-1">
            <div className="text-lg font-bold leading-none">
              {formatStorePrice(p.price)} <span className="text-[10px] font-medium text-neutral-500">{STORE_CURRENCY_CODE}</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-1 truncate">{p.sku}</div>
          </div>
          <div className="flex items-center glass rounded-full overflow-hidden">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-2">
              <Minus size={12} />
            </button>
            <div className="px-2 mono text-[12px] min-w-[2ch] text-center">{qty}</div>
            <button onClick={() => setQty((q) => q + 1)} className="px-3 py-2">
              <Plus size={12} />
            </button>
          </div>
          <button
            onClick={addToCart}
            className="btn-primary py-2.5 px-4 text-[13px]"
            data-testid="mobile-add-to-cart"
          >
            Add
          </button>
        </div>
      </main>

      <ImageModal
        open={modalOpen}
        images={imageUrls}
        startIndex={imgIdx}
        onClose={() => setModalOpen(false)}
        alt={p.name}
      />
      <Footer />
    </>
  );
}

function ReviewsSection({ product, data, onUpdated, embedded = false }) {
  const user = useAuthStore((s) => s.user);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => reviewsApi.list(product.slug).then(({ data: next }) => onUpdated(next)).catch(() => {});

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await reviewsApi.create(product.slug, { rating, title, body });
      setTitle("");
      setBody("");
      await refresh();
      toast.success("Review published", { description: "Verified purchase review" });
    } catch (err) {
      toast.error(err.response?.data?.error || "Could not submit review");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className={embedded ? "" : "mt-16 border-t border-white/5 pt-10"}
      data-testid="product-reviews"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="section-label mb-3"><span className="num">REVIEWS</span> VERIFIED BUYERS</div>
          <h2 className="text-2xl font-semibold">What customers say</h2>
        </div>
        {data.summary.count > 0 && (
          <div className="flex items-center gap-2" aria-label={`${data.summary.average} out of 5 stars from ${data.summary.count} reviews`}>
            <div className="flex text-amber-500">{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} fill={n <= Math.round(data.summary.average) ? "currentColor" : "none"} />)}</div>
            <span className="mono text-[12px]">{data.summary.average}/5 · {data.summary.count} review{data.summary.count === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
        <div className="space-y-4">
          {data.reviews.length === 0 ? (
            <div className="glass-soft rounded-xl p-5 text-[14px]" style={{ color: "var(--fg-muted)" }}>
              No reviews yet. Verified buyers can share their experience after their order ships.
            </div>
          ) : data.reviews.map((review) => (
            <article key={review._id || `${review.createdAt}-${review.displayName}`} className="glass-soft rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex text-amber-500">{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill={n <= review.rating ? "currentColor" : "none"} />)}</div>
                <time className="mono text-[10px] text-neutral-500" dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time>
              </div>
              {review.title && <h3 className="font-semibold text-[15px] mt-3">{review.title}</h3>}
              <p className="text-[14px] leading-relaxed mt-2" style={{ color: "var(--fg-muted)" }}>{review.body}</p>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-neutral-500">
                <span>{review.displayName}</span>
                {review.verifiedPurchase && <span className="text-emerald-500">Verified purchase</span>}
              </div>
            </article>
          ))}
        </div>

        <div className="glass rounded-xl p-5 h-fit">
          <h3 className="font-semibold text-[15px]">Bought this module?</h3>
          {user ? (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <div className="flex items-center gap-1" aria-label="Choose rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} className="p-1 text-amber-500 hover:scale-110 transition-transform">
                    <Star size={19} fill={n <= rating ? "currentColor" : "none"} />
                  </button>
                ))}
              </div>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Review title (optional)" maxLength={120} />
              <textarea className="input min-h-28 resize-y" value={body} onChange={(e) => setBody(e.target.value)} placeholder="How did it work for your system?" minLength={10} maxLength={2000} required />
              <button className="btn-primary w-full" disabled={submitting}>{submitting ? "Publishing..." : "Publish verified review"}</button>
              <p className="text-[11px] text-neutral-500">Only paid orders that have shipped can review. Low ratings are published too.</p>
            </form>
          ) : (
            <p className="text-[13px] leading-relaxed mt-2" style={{ color: "var(--fg-muted)" }}>
              <Link to="/account" className="underline">Sign in</Link> with the account used for your order to leave a verified review.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// Fetches recently-viewed products from API by slug
function RecentlyViewedSection({ slugs, currentSlug }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    Promise.all(
      slugs
        .filter((s) => s !== currentSlug)
        .slice(0, 4)
        .map((s) => productsApi.getBySlug(s).then(({ data }) => data?.product).catch(() => null))
    ).then((results) => setItems(results.filter(Boolean)));
  }, [slugs, currentSlug]);

  if (!items.length) return null;
  return (
    <div className="mt-16">
      <div className="section-label mb-4">
        <span className="num">·</span> Recently viewed
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="recently-viewed">
        {items.map((r, i) => (
          <ProductCard key={r.slug} p={r} index={i} />
        ))}
      </div>
    </div>
  );
}

function SpecsTable({ p }) {
  const rows = [
    ["Manufacturer", p.brand],
    ["Manufacturer Part Number", p.mpn],
    ["Generation", p.generation],
    ["Form Factor", p.formFactor],
    ["Capacity (kit)", p.capacityLabel],
    ["Kit Configuration", p.kit],
    ["Speed", p.speedLabel],
    ["CAS Latency", p.cas],
    ["Timings", p.timings],
    ["Voltage", p.voltage],
    ["ECC", p.ecc ? "Yes" : "No"],
    ["Register Type", p.formFactor === "RDIMM" || p.formFactor === "LRDIMM" ? p.formFactor : "Unbuffered"],
    ["Rank", p.rank],
    ["Profile", p.profile],
    ["Heatspreader", p.heatspreader],
    ["Condition", p.condition],
    ["Warranty", p.warranty],
    ["SKU", p.sku],
  ];
  return (
    <div data-testid="product-specs-content">
      <div className="divide-y divide-white/5">
        {rows.map(([k, v]) => v ? (
          <div key={k} className="grid grid-cols-[160px_1fr] gap-4 py-2.5 text-[13.5px]">
            <div className="text-neutral-500">{k}</div>
            <div className="text-neutral-100">{v}</div>
          </div>
        ) : null)}
      </div>
    </div>
  );
}
