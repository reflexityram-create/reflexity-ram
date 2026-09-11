import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Cpu, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { buildLeadPrefill } from "@/components/LeadForm";
import { productsApi } from "@/lib/api";
import { DETAIL_IMAGE_WIDTHS, imageSrcSet, imageUrl } from "@/lib/imageUrl";
import { useSEO } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";

export default function Product() {
  const { slug } = useParams(); const [product, setProduct] = useState(null); const [loading, setLoading] = useState(true); const [missing, setMissing] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setProduct(null); setLoading(true); setMissing(false);
    productsApi.getBySlug(slug, { signal: controller.signal })
      .then(({ data }) => { if (!active) return; setProduct(data?.product || null); })
      .catch((error) => { if (!active) return; if (error?.code !== "ERR_CANCELED" && error?.name !== "AbortError") setMissing(true); })
      .finally(() => { if (!active) return; setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [slug]);
  const specification = product && [product.capacityLabel, product.generation, product.formFactor, product.speedLabel, product.ecc ? "ECC" : ""].filter(Boolean).join(" ");
  useSEO({ title: product ? `${product.name} | Inventory` : "Inventory item", description: product ? `${product.name}. Quote-only bulk inventory inquiry from Reflexity.` : "" });
  const schema = useMemo(() => product ? { "@context": "https://schema.org", "@type": "Product", name: product.name, image: (product.images || []).map(imageUrl), sku: product.sku, mpn: product.mpn, description: `${specification}. Quote-only inventory listing from Reflexity.`.trim(), additionalProperty: [["Generation", product.generation], ["Form factor", product.formFactor], ["Capacity", product.capacityLabel], ["Speed", product.speedLabel], ["Condition", product.condition]].filter(([, value]) => value).map(([name, value]) => ({ "@type": "PropertyValue", name, value })) } : null, [product, specification]);
  if (loading) return <><Header /><main className="page"><div className="container-tight catalog-status"><Loader2 className="animate-spin" /> Loading inventory item…</div></main><Footer /></>;
  if (missing || !product) return <><Header /><main className="page"><div className="container-tight catalog-status"><h1>Inventory item unavailable</h1><p>This item is not currently in the public catalog.</p><Link to="/inventory">Back to inventory</Link></div></main><Footer /></>;
  const details = [["Part number", product.mpn || product.sku], ["Generation", product.generation], ["Form factor", product.formFactor], ["Capacity", product.capacityLabel], ["Speed", product.speedLabel], ["ECC", product.ecc ? "Yes" : "Not specified"], ["Condition", product.condition], ["Availability", product.stockQuantity ? `${product.stockQuantity}+ listed` : product.stockLabel || "Confirm by quote"]].filter(([, value]) => value);
  const quote = buildLeadPrefill({ intent: "buy", productType: "RAM", sourceType: "catalog-product", sourceId: product.id || product._id || product.slug, sourceCode: product.slug || "", sku: product.sku || "", itemTitle: product.name || "", partNumber: product.mpn || "", specification, quantity: "" });
  return <><Header />{schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }} />}<main className="page"><section className="container-tight inventory-detail"><Link className="back-link" to="/inventory"><ChevronLeft size={15} />Back to inventory</Link><div className="inventory-detail-grid"><div className="inventory-image detail-image">{product.images?.[0] ? <img src={imageUrl(product.images[0], { width: 1200 })} srcSet={imageSrcSet(product.images[0], DETAIL_IMAGE_WIDTHS)} sizes="(min-width: 1024px) 52vw, 100vw" alt={product.name} width="1200" height="960" fetchPriority="high" loading="eager" /> : <Cpu size={48} />}</div><div><p className="mono">{product.sku || product.mpn || "INVENTORY ITEM"}</p><h1>{product.name}</h1><p className="detail-summary">{product.description || "Use the exact part number and required quantity to request availability."}</p><dl className="spec-table">{details.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><Link className="btn-primary" to={quote}>Request bulk quote</Link><p className="detail-note">This listing is an inquiry point, not an offer to sell. Lot-specific availability and terms are confirmed in writing.</p></div></div></section></main><Footer /></>;
}
