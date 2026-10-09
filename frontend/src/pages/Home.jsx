import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ProductCard from "@/components/ProductCard";
import { isPublicServerRam, pickFeatured } from "@/lib/catalog";
import { imageSrcSet, imageUrl } from "@/lib/imageUrl";
import {
  formatStorePrice,
  formatStorePriceWithCode,
  LARGE_ORDER_MIN_STICKS,
  LARGE_ORDER_SHIPPING_PRICE,
  STANDARD_SHIPPING_PRICE,
  STORE_CURRENCY_CODE,
} from "@/lib/currency";
import { useSEO } from "@/lib/seo";
import { useStock } from "@/lib/useStock";

/**
 * Storefront home: the headline and trust points on the left, the featured
 * stick on the right (the admin's "Feature on the home page" pick, else the
 * highest-priced stick in stock), then the rest of the inventory.
 */
const TRUST = ["Tested or factory sealed", "Ships in 1–3 business days, tracked", "30-day returns", "Secure checkout by Stripe"];

function FeaturedProduct({ p }) {
  const image = p.images?.[0];
  const specs = [p.generation, p.formFactor, p.capacityLabel, p.speedLabel].filter(Boolean);
  const shortName = [p.brand, p.capacityLabel, p.generation, p.formFactor].filter(Boolean).join(" ");
  const sealed = /sealed/i.test(p.name || "");
  return (
    <Link
      to={`/shop/${p.slug}`}
      className="glass card-hover rounded-2xl overflow-hidden flex flex-col"
      style={{ textDecoration: "none" }}
      data-testid="home-featured"
    >
      <div className="relative bg-white aspect-[2/1] px-6 py-7 sm:px-9 sm:py-9">
        {image && (
          <img
            src={imageUrl(image, { width: 1280, trim: true })}
            srcSet={imageSrcSet(image, undefined, { trim: true })}
            sizes="(min-width: 1024px) 45vw, 92vw"
            alt={p.name}
            className="w-full h-full object-contain"
            width="1280"
            height="400"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        )}
        <span className="absolute top-3 left-3 pill pill-amber text-[10px] py-0.5 px-2">Featured</span>
      </div>
      <div className="p-5 sm:p-6">
        <div className="mono text-[10px] sm:text-[11px] tracking-widest uppercase" style={{ color: "var(--fg-faint)" }}>
          {specs.join(" · ")}
        </div>
        <div className="mt-1.5 text-[22px] sm:text-[26px] font-bold tracking-tight leading-tight text-white">{shortName}</div>
        <div className="mt-1 text-[13px] line-clamp-1" style={{ color: "var(--fg-muted)" }}>{p.name}</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[28px] font-bold tracking-tight">{formatStorePrice(p.price)}</span>
            <span className="text-[11px]" style={{ color: "var(--fg-muted)" }}>{STORE_CURRENCY_CODE}</span>
          </div>
          <span className="btn-primary">View this stick <ArrowRight size={15} /></span>
        </div>
        <div className="mt-2 inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--fg-muted)" }}>
          <span className={`dot ${p.stock === "low" ? "dot-amber" : "dot-green"}`} />
          {p.stockLabel} · {sealed ? "Factory sealed, unopened" : "Tested before listing"}
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  useSEO({
    title: "Server RAM in Canada — Tested DDR4 & DDR5",
    description:
      "Tested Server RAM, including individual modules and small lots, shipped from Toronto.",
  });
  const { loading, products } = useStock(6);
  const publicProducts = products.filter(isPublicServerRam);
  const featured = pickFeatured(publicProducts);
  const rest = publicProducts.filter((p) => p !== featured);

  return (
    <>
      <Header />
      <main className="page" data-testid="home-page">
        <section>
          <div className="container-tight pt-8 sm:pt-12 pb-14">
            <div className="grid lg:grid-cols-[1fr_1.1fr] gap-8 lg:gap-12 items-center">
              <div>
                <div className="section-label mb-4">
                  <span className="num">01</span> SERVER RAM · TORONTO
                </div>
                <h1 className="display-2 max-w-[15ch]">
                  Memory that's been <span className="hl">tested first.</span>
                </h1>
                <p className="mt-5 text-[15px] max-w-[34rem]" style={{ color: "var(--fg-muted)" }}>
                  Ships from Toronto to Canada and 70+ countries, tracked.{" "}
                  {formatStorePriceWithCode(STANDARD_SHIPPING_PRICE, 0)} flat in Canada ({formatStorePriceWithCode(LARGE_ORDER_SHIPPING_PRICE, 0)} for {LARGE_ORDER_MIN_STICKS}+ sticks); abroad, Canada Post's price at checkout.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link to="/shop" className="btn-primary">Shop all RAM <ArrowRight size={15} /></Link>
                  <Link to="/wholesale" className="btn-secondary">Bulk pricing</Link>
                </div>
                <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px]" style={{ color: "var(--fg-muted)" }}>
                  {TRUST.map((t) => (
                    <li key={t} className="inline-flex items-center gap-1.5">
                      <Check size={14} style={{ color: "var(--brand-yellow-deep)" }} /> {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                {loading ? (
                  <div className="skeleton rounded-2xl" style={{ height: 420 }} />
                ) : featured ? (
                  <FeaturedProduct p={featured} />
                ) : (
                  <p style={{ color: "var(--fg-muted)" }}>
                    Nothing listed right now — <Link to="/support" className="underline">email us</Link> for current stock.
                  </p>
                )}
              </div>
            </div>

            {(loading || rest.length > 0) && (
              <>
                <div className="section-label mt-14 mb-5">
                  <span className="num">02</span> AVAILABLE INVENTORY
                </div>
                {loading ? (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="skeleton" style={{ height: 260 }} />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
                    {rest.map((p, i) => (
                      <ProductCard
                        key={p._id || p.slug}
                        p={p}
                        index={i}
                        itemListId="home_inventory"
                        itemListName="Home inventory"
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="callout-brand mt-14 rounded-xl px-6 py-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="callout-title font-semibold">Buying in volume?</div>
                <div className="callout-body text-[14px]">
                  We do wholesale on server pulls — tell us the SKU and quantity.
                </div>
              </div>
              <Link to="/wholesale" className="btn-primary">Get bulk pricing</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
