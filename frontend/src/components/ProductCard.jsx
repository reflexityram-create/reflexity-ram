import { Link } from "react-router-dom";
import { ArrowUpRight, Cpu } from "lucide-react";
import { imageSrcSet, imageUrl } from "@/lib/imageUrl";

export default function ProductCard({ p, index = 0, priority = false }) {
  const image = p.images?.[0];
  return <Link to={`/inventory/${p.slug}`} className="inventory-card" style={{ animationDelay: `${(index % 8) * 0.035}s` }} data-testid={`inventory-card-${p.slug}`}>
    <div className="inventory-image">{image ? <img src={imageUrl(image, { width: 480 })} srcSet={imageSrcSet(image)} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw" alt={p.name} width="640" height="512" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" /> : <Cpu size={35} aria-hidden="true" />}</div>
    <div className="inventory-card-body"><div className="inventory-card-top"><span className="mono">{p.sku || p.mpn || "CATALOG ITEM"}</span><span>{p.stockQuantity ? `${p.stockQuantity}+ available` : p.stockLabel || "Ask availability"}</span></div><h2>{p.name}</h2><div className="inventory-specs"><span>{p.generation}</span><span>{p.formFactor}</span><span>{p.capacityLabel}</span><span>{p.speedLabel}</span>{p.ecc && <span>ECC</span>}</div><div className="inventory-card-cta">Request bulk quote <ArrowUpRight size={15} /></div></div>
  </Link>;
}
