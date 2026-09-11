import { Link } from "react-router-dom";
import { Cpu } from "lucide-react";
import { imageSrcSet, imageUrl } from "@/lib/imageUrl";
import { formatStorePrice, STORE_CURRENCY_CODE } from "@/lib/currency";

export default function ProductCard({ p, index = 0, priority = false }) {
  const image = p.images?.[0];
  const primaryImage = imageUrl(image, { width: 480 });

  return (
    <Link
      to={`/shop/${p.slug}`}
      className="glass card-hover rounded-xl overflow-hidden flex flex-col fade-up"
      style={{ animationDelay: `${(index % 8) * 0.04}s` }}
      data-testid={`product-card-${p.slug}`}
    >
      <div className="relative aspect-[5/4] bg-gradient-to-b from-white/[0.03] to-transparent overflow-hidden">
        {primaryImage ? (
          <img
            src={primaryImage}
            srcSet={imageSrcSet(image)}
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"
            alt={p.name}
            className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform"
            width="640"
            height="512"
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Cpu size={36} className="text-neutral-700" />
          </div>
        )}

        <div className="absolute top-3 left-3 flex gap-1.5">
          <span className="pill text-[10px] py-1 px-2">{p.generation}</span>
          <span className="pill text-[10px] py-1 px-2">{p.formFactor}</span>
        </div>

        <div className="absolute top-3 right-3">
          <span
            className={`pill text-[10px] py-1 px-2 ${
              p.stock === "low" ? "pill-amber" : p.stock === "out" ? "" : "pill-accent"
            }`}
            data-testid={`stock-${p.slug}`}
          >
            <span
              className={`dot ${
                p.stock === "low" ? "dot-amber" : p.stock === "out" ? "dot-red" : "dot-green"
              }`}
            />
            {p.stockLabel}
          </span>
        </div>

        {/* Shipping coverage badge — positive framing, bottom-left */}
        <div className="absolute bottom-3 left-3">
          <span className="pill text-[10px] py-1 px-2 bg-black/50 backdrop-blur-sm">
            🇨🇦 🇺🇸 CA &amp; US
          </span>
        </div>
      </div>

      <div className="p-5 flex flex-col flex-1">
        <div className="mono text-[10px] text-neutral-500 tracking-widest mb-2">
          {p.sku}
        </div>
        <h2 className="text-[15px] font-semibold tracking-tight text-white leading-snug mb-2">
          {p.name}
        </h2>

        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="pill text-[10px] py-0.5">{p.capacityLabel}</span>
          <span className="pill text-[10px] py-0.5">{p.speedLabel}</span>
          <span className="pill text-[10px] py-0.5">{p.cas}</span>
          {p.ecc && (
            <span className="pill pill-accent text-[10px] py-0.5">ECC</span>
          )}
        </div>

        <div className="mt-auto flex items-end gap-3">
          <div className="text-2xl font-bold tracking-tight">
            {formatStorePrice(p.price)} <span className="text-[10px] font-medium text-neutral-500">{STORE_CURRENCY_CODE}</span>
          </div>
          {p.compareAt && p.compareAt > p.price && (
            <>
              <div className="text-[12px] text-neutral-500 line-through mb-1">
                {formatStorePrice(p.compareAt)}
              </div>
              <div className="ml-auto mb-1 mono text-[10px] text-emerald-300">
                Save {formatStorePrice(p.compareAt - p.price, 0)}
              </div>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
