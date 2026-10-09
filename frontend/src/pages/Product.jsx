import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ShoppingCart,
  Copy,
  Check,
  AlertTriangle,
  Package,
  Cpu,
  Star,
} from "lucide-react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ImageModal from "@/components/ImageModal";
import ProductCard from "@/components/ProductCard";
import QuantityStepper from "@/components/QuantityStepper";
import { DETAIL_IMAGE_WIDTHS, imageSrcSet, imageUrl } from "@/lib/imageUrl";
import EmptyState from "@/components/EmptyState";
import { useCart, useRecentlyViewed } from "@/lib/store";
import useAuthStore from "@/lib/authStore";
import { useSEO } from "@/lib/seo";
import { productsApi } from "@/lib/api";
import { reviewsApi } from "@/lib/api";
import { isPublicServerRam } from "@/lib/catalog";
import { clampQuantity, limitNote, quantityLimit } from "@/lib/quantity";
import { serializeJsonLd } from "@/lib/safeJsonLd";
// The edge function (functions-shared) and this page build the Product schema, title and description with the SAME code.
import { buildProductSchema, productSeoDescription, productSeoTitle } from "../../functions-shared/productMetadata.js";
import { ecommerceItem, trackEvent } from "@/lib/analytics";
import {
  formatStorePrice,
  formatStorePriceWithCode,
  shippingPriceFor,
  hasOwnShippingPrice,
  LARGE_ORDER_MIN_STICKS,
  LARGE_ORDER_SHIPPING_PRICE,
  FASTER_SHIPPING_UPCHARGE,
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
  // The picker stops at the stock on hand (the product arrives with its count).
  const limit = quantityLimit(p?.stockQuantity);
  const soldOut = limit < 1;
  const [imgIdx, setImgIdx] = useState(0);
  const [tab, setTab] = useState("specs");
  // "More below" links and "All specifications" open a tab and scroll to it.
  const detailsRef = useRef(null);
  const openTab = (id) => {
    setTab(id);
    detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [skuCopied, setSkuCopied] = useState(false);
  const [reviewData, setReviewData] = useState({ reviews: [], summary: { count: 0, average: 0 } });

  const addItem = useCart((s) => s.addItem);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const addViewed = useRecentlyViewed((s) => s.add);
  const recentSlugs = useRecentlyViewed((s) => s.slugs);

  useSEO({
    title: p ? productSeoTitle(p) : undefined,
    description: p ? productSeoDescription(p) : null,
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
        if (!isPublicServerRam(product)) { setNotFound(true); return; }
        setP(product);
        if (product) addViewed(product.slug);
        // Fetch related products (same generation, excluding this one)
        productsApi.list({ generation: product.generation, limit: 4 }, { signal: controller.signal })
          .then(({ data: d }) => {
            if (!active) return;
            setRelated((d.products || []).filter(isPublicServerRam).filter((x) => x.slug !== product.slug).slice(0, 3));
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

  useEffect(() => {
    if (!p?.slug) return;
    trackEvent("view_item", {
      currency: STORE_CURRENCY_CODE,
      value: Number(p.price || 0),
      items: [ecommerceItem(p)],
    });
  }, [p?.slug]);

  // A direct request gets crawler-visible Product JSON-LD from the Pages
  // Function. Once React owns the rendered route, remove that server copy so
  // the live DOM has exactly the current client schema (including reviews) and
  // SPA navigation cannot retain metadata for the previously viewed product.
  useEffect(() => {
    if (!p?.slug) return;
    document.querySelectorAll("script[data-edge-product]").forEach((node) => node.remove());
  }, [p?.slug]);

  // A new product starts at one stick; a stock count below the choice pulls the choice down to it.
  useEffect(() => { setQty(1); }, [slug]);
  useEffect(() => { setQty((q) => clampQuantity(q, limit).qty || 1); }, [limit]);

  const recentlyViewed = useMemo(() => {
    return recentSlugs
      .filter((s) => s !== slug)
      .slice(0, 4);
  }, [recentSlugs, slug]);

  // JSON-LD structured data for Google rich results
  const jsonLd = useMemo(() => {
    if (!p) return null;
    const data = buildProductSchema(p, {
      url: `https://reflexityram.com/shop/${p.slug}`,
      description: productSeoDescription(p, 180),
      images: (p.images || []).map(imageUrl).filter(Boolean),
    });
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
              description="That Server RAM SKU isn't in our catalog. Contact us with the part number you need."
              ctaLabel="Back to shop"
              ctaTo="/shop"
              secondaryLabel="Email us"
              secondaryTo="/support"
              as="h1"
            />
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const addToCart = async () => {
    if (soldOut) return;
    const result = await addItem(p.slug, qty);
    if (result && !result.success) {
      toast.error(result.message || "Failed to add to cart");
      return;
    }
    toast.success("Added to cart", {
      description: `${qty} × ${p.name}`,
      icon: <Check size={16} className="text-emerald-400" />,
    });
    trackEvent("add_to_cart", {
      currency: STORE_CURRENCY_CODE,
      value: Number(p.price || 0) * qty,
      items: [ecommerceItem(p, qty)],
    });
  };

  const buyNow = async () => {
    if (soldOut) return;
    const result = await addItem(p.slug, qty);
    if (result && !result.success) {
      toast.error(result.message || "Failed to add to cart");
      return;
    }
    trackEvent("add_to_cart", {
      currency: STORE_CURRENCY_CODE,
      value: Number(p.price || 0) * qty,
      items: [ecommerceItem(p, qty)],
    });
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
            className="tap-target inline-flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-white mb-6"
            data-testid="product-back-link"
          >
            <ChevronLeft size={14} /> Back to shop
          </Link>

          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14">
            {/* Gallery */}
            <div>
              <button
                className="block w-full glass rounded-2xl overflow-hidden aspect-[2/1] sm:aspect-[16/9] mb-3 cursor-zoom-in !bg-white p-4 sm:p-8"
                onClick={() => setModalOpen(true)}
                data-testid="product-main-image-btn"
              >
                {imageUrls[imgIdx] ? (
                  <img
                    src={imageUrl(imageUrls[imgIdx], { width: 1200, trim: true })}
                    srcSet={imageSrcSet(imageUrls[imgIdx], DETAIL_IMAGE_WIDTHS, { trim: true })}
                    sizes="(min-width: 1024px) 52vw, 100vw"
                    alt={p.name}
                    className="w-full h-full object-contain"
                    width="1200"
                    height="675"
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
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
                      <img src={imageUrl(src, { width: 240 })} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
              <KeySpecs p={p} onMore={() => openTab("specs")} className="hidden lg:block mt-5" />
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
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight mb-4">
                {p.name}
              </h1>

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
                  Dispatch: {p.estimatedDispatch || "1–3 business days"}
                </span>
              </div>

              {/* Qty + add to cart */}
              <div className="flex flex-wrap items-stretch gap-3 mb-5">
                <QuantityStepper
                  value={qty}
                  onChange={setQty}
                  limit={limit}
                  note={limitNote(p.stockQuantity)}
                  noteClassName="order-last basis-full"
                  testId="product-qty"
                />
                <button
                  onClick={addToCart}
                  disabled={soldOut}
                  className="btn-primary flex-1 sm:flex-none min-w-[9.5rem] whitespace-nowrap"
                  data-testid="product-add-to-cart-btn"
                >
                  <ShoppingCart size={15} /> Add to cart
                </button>
                <button
                  onClick={buyNow}
                  disabled={soldOut}
                  className="btn-secondary flex-1 sm:flex-none min-w-[7rem] whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="product-buy-now-btn"
                >
                  Buy now
                </button>
              </div>

              <KeySpecs p={p} onMore={() => openTab("specs")} className="lg:hidden mb-5" />

              {/* Trust strip — quick reassurance at the point of decision */}
              <ul className="grid grid-cols-2 gap-x-4 gap-y-2 mb-5 text-[13px] text-neutral-600 dark:text-neutral-300">
                {[conditionBadge(p), `${p.warranty} warranty`, "Ships from Toronto", "Secure checkout"].map((t) => (
                  <li key={t} className="inline-flex items-center gap-2">
                    <span className="text-emerald-600 dark:text-emerald-400">✓</span> {t}
                  </li>
                ))}
              </ul>

              {/* A visible signal that the details continue below the fold */}
              <nav aria-label="Product details" className="flex flex-wrap items-center gap-2" data-testid="product-jump-links">
                <span className="text-[12px] text-neutral-500 mr-1">More below:</span>
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openTab(t.id)}
                    className="pill text-[11px] py-1 px-2.5 hover:border-white/30"
                    data-testid={`product-jump-${t.id}`}
                  >
                    {t.label} ↓
                  </button>
                ))}
              </nav>

              <div className="mono text-[10.5px] text-neutral-600 leading-relaxed mt-4">
                {p.note}
              </div>
            </div>
          </div>

          {/* Where it ships and what it costs, one tile per audience, across the full width */}
          <section className="glass rounded-2xl p-4 sm:p-5 mt-8" aria-label="Shipping and returns" data-testid="product-delivery">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="mono text-[11px] tracking-widest text-neutral-500">SHIPPING &amp; RETURNS</div>
              <Link to="/international" className="text-[12px] font-medium underline underline-offset-4">
                Shipping details →
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {deliveryTiles(p).map(({ icon, title, body }) => (
                <div key={title} className="flex items-start gap-3 rounded-xl bg-white/5 p-3.5">
                  <span className="text-[22px] leading-none mt-0.5" aria-hidden="true">{icon}</span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold">{title}</div>
                    <div className="text-[12.5px] leading-relaxed text-neutral-500 mt-0.5">{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* TABS */}
          <div ref={detailsRef} id="product-details" className="mt-8 pt-2 scroll-mt-20">
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
                  <p>Orders typically ship within 1–3 business days of purchase. In Canada, delivery is estimated within 3–6 business days after dispatch; outside Canada, checkout shows Canada Post's delivery time for your country.</p>
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
                  <ProductCard
                    key={r.slug}
                    p={r}
                    index={i}
                    itemListId="related_products"
                    itemListName="Related products"
                  />
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
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold leading-none">
              {formatStorePrice(p.price)} <span className="text-[10px] font-medium text-neutral-500">{STORE_CURRENCY_CODE}</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-1 truncate">{p.sku}</div>
          </div>
          <QuantityStepper
            size="sm"
            value={qty}
            onChange={setQty}
            limit={limit}
            note={limitNote(p.stockQuantity)}
            notePlacement="above"
            className="shrink-0"
            testId="mobile-qty"
          />
          <button
            onClick={addToCart}
            disabled={soldOut}
            className="btn-primary shrink-0 py-2.5 px-4 text-[13px]"
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
              Checked out as a guest? We email you a review link about 10 days after your order ships.
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
    ).then((results) => setItems(results.filter(Boolean).filter(isPublicServerRam)));
  }, [slugs, currentSlug]);

  if (!items.length) return null;
  return (
    <div className="mt-16">
      <div className="section-label mb-4">
        <span className="num">·</span> Recently viewed
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="recently-viewed">
        {items.map((r, i) => (
          <ProductCard
            key={r.slug}
            p={r}
            index={i}
            itemListId="recently_viewed_products"
            itemListName="Recently viewed products"
          />
        ))}
      </div>
    </div>
  );
}

// A factory-sealed module was not opened, so it was not tested here.
function conditionBadge(p) {
  if (/sealed/i.test(p.name || "")) return "Factory sealed, unopened";
  if (p.condition === "New") return "Brand new";
  return "Individually tested";
}

// US checkout declares the product's country of origin and HS code to customs, so it is open for a product once both are saved.
const usOnWebsite = (p) => /^[A-Za-z]{2}$/.test(String(p?.countryOfOrigin || "")) && /^\d{4}/.test(String(p?.hsCode || ""));

// One tile per audience: Canada, abroad, the US, and returns. The icons are emoji so they look the
// same everywhere (flag emoji show as two letters on Windows).
function deliveryTiles(p) {
  const canada = formatStorePriceWithCode(shippingPriceFor(p), 0);
  const large = hasOwnShippingPrice(p)
    ? ""
    : ` (${formatStorePriceWithCode(LARGE_ORDER_SHIPPING_PRICE, 0)} for ${LARGE_ORDER_MIN_STICKS}+ sticks)`;
  return [
    {
      icon: "🍁",
      title: "Canada",
      body: `${canada} flat rate${large}. Tracked, ESD-safe packing, estimated 3–6 business days after dispatch. Want it sooner? Faster shipping is +${formatStorePriceWithCode(FASTER_SHIPPING_UPCHARGE, 0)} at checkout.`,
    },
    {
      icon: "🌍",
      title: "Worldwide",
      body: "Pick your country at checkout to see Canada Post's tracked price and delivery time. 70+ countries.",
    },
    {
      icon: "🗽",
      title: "United States",
      body: usOnWebsite(p)
        ? "Choose Another country, then United States, at checkout: Canada Post Tracked Packet – USA, with US import duties and fees prepaid in your total so nothing is due on delivery. If United States is not on the list, email us."
        : (
          <>
            Not on the website for this item yet.{" "}
            <Link to="/support" className="underline underline-offset-2">Email us</Link> for a price.
          </>
        ),
    },
    {
      icon: "↩️",
      title: "30-day returns",
      body: (
        <>
          Return it within 30 days of delivery in its original condition.{" "}
          <Link to="/returns" className="underline underline-offset-2">Returns policy</Link>
        </>
      ),
    },
  ];
}

// "South Korea" for a stored country code.
const madeInLabel = (p) => (p.countryOfOrigin ? new Intl.DisplayNames(["en"], { type: "region" }).of(p.countryOfOrigin) : null);

// The specs buyers check first, near the top of the page (the full table is in
// the Specifications tab below).
function KeySpecs({ p, onMore, className = "" }) {
  const items = [
    ["Capacity", p.capacityLabel],
    ["Speed", p.speedLabel],
    ["Type", [p.generation, p.formFactor].filter(Boolean).join(" ")],
    ["Rank", p.rank],
    ["Voltage", p.voltage ? `${p.voltage}${/v\s*$/i.test(String(p.voltage)) ? "" : " V"}` : null],
    ["ECC", p.ecc ? "Yes" : "No"],
    ["CAS latency", p.cas],
    ["Made in", madeInLabel(p)],
    ["Part number", p.mpn],
  ].filter(([, v]) => v);
  return (
    <section className={`glass rounded-2xl p-5 ${className}`} aria-label="Key specs" data-testid="product-key-specs">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="mono text-[11px] tracking-widest text-neutral-500">KEY SPECS</div>
        <button type="button" onClick={onMore} className="text-[12px] font-medium underline underline-offset-4">
          All specifications ↓
        </button>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11.5px] text-neutral-500">{k}</dt>
            <dd className="text-[14px] font-medium text-neutral-100 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SpecsTable({ p }) {
  const rows = [
    ["Manufacturer", p.brand],
    ["Manufacturer Part Number", p.mpn],
    ["Made in", madeInLabel(p)],
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
