import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Cpu } from "lucide-react";
import { imageSrcSet, imageUrl } from "@/lib/imageUrl";
import { formatStorePrice, STORE_CURRENCY_CODE } from "@/lib/currency";
import { ecommerceItem, trackEvent } from "@/lib/analytics";

// Compact card: the photo is trimmed to the module on a white panel (the
// photos have white backgrounds), then one spec line, the name, the price and
// the stock status (kept off the photo, where it covered small images).
// Two per row on phones, three on desktop. The part number, CAS latency and
// shipping details live on the product page.
export default function ProductCard({
  p,
  index = 0,
  priority = false,
  itemListId = "product_grid",
  itemListName = "Product grid",
}) {
  const cardRef = useRef(null);
  const impressionTracked = useRef(false);
  const image = p.images?.[0];
  const primaryImage = imageUrl(image, { width: 640, trim: true });
  const specs = [p.generation, p.formFactor, p.capacityLabel, p.speedLabel].filter(Boolean);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !p?.slug || typeof IntersectionObserver !== "function") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (impressionTracked.current || !entries.some((entry) => entry.isIntersecting)) return;
      impressionTracked.current = true;
      trackEvent("view_item_list", {
        item_list_id: itemListId,
        item_list_name: itemListName,
        items: [ecommerceItem(p)],
      });
      observer.disconnect();
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [itemListId, itemListName, p]);

  const selectItem = () => trackEvent("select_item", {
    item_list_id: itemListId,
    item_list_name: itemListName,
    items: [ecommerceItem(p)],
  });

  return (
    <Link
      ref={cardRef}
      to={`/shop/${p.slug}`}
      onClick={selectItem}
      className="glass card-hover rounded-xl overflow-hidden flex flex-col fade-up"
      style={{ animationDelay: `${(index % 8) * 0.04}s` }}
      data-testid={`product-card-${p.slug}`}
    >
      <div className="relative aspect-[2/1] bg-white overflow-hidden px-3 py-4 sm:px-5 sm:py-5">
        {primaryImage ? (
          <img
            src={primaryImage}
            srcSet={imageSrcSet(image, undefined, { trim: true })}
            sizes="(min-width: 1024px) 30vw, 46vw"
            alt={p.name}
            className="w-full h-full object-contain"
            width="960"
            height="300"
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
          />
        ) : (
          <Cpu size={32} className="w-full h-full text-neutral-400" />
        )}
      </div>

      <div className="p-3 sm:p-4 flex flex-col flex-1">
        <div className="mono text-[9px] sm:text-[10px] text-neutral-500 tracking-widest uppercase mb-1.5">
          {specs.join(" · ")}
        </div>
        <h2 className="text-[13px] sm:text-[15px] font-semibold tracking-tight text-white leading-snug line-clamp-3 sm:line-clamp-2 mb-3">
          {p.name}
        </h2>

        <div className="mt-auto flex flex-wrap items-baseline gap-x-2">
          <div className="text-lg sm:text-xl font-bold tracking-tight">
            {formatStorePrice(p.price)} <span className="text-[10px] font-medium text-neutral-500">{STORE_CURRENCY_CODE}</span>
          </div>
          {p.compareAt && p.compareAt > p.price && (
            <>
              <div className="text-[12px] text-neutral-500 line-through">
                {formatStorePrice(p.compareAt)}
              </div>
              <div className="mono text-[10px] text-emerald-300">
                Save {formatStorePrice(p.compareAt - p.price, 0)}
              </div>
            </>
          )}
        </div>
        <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] sm:text-[12px] text-neutral-500" data-testid={`stock-${p.slug}`}>
          <span
            className={`dot ${
              p.stock === "low" ? "dot-amber" : p.stock === "out" ? "dot-red" : "dot-green"
            }`}
          />
          {p.stockLabel}
        </div>
      </div>
    </Link>
  );
}
